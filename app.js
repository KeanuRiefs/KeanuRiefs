import * as THREE from './libs/three/three.module.js';
import { GLTFLoader } from './libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from './libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from './libs/three/jsm/RGBELoader.js';
import { Stats } from './libs/stats.module.js';
import { LoadingBar } from './libs/LoadingBar.js';
import { VRButton } from './libs/VRButton.js';
import { CanvasUI } from './libs/CanvasUI.js';
import { GazeController } from './libs/GazeController.js';
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

class App {
	constructor() {
		const container = document.createElement('div');
		document.body.appendChild(container);

		this.assetsPath = './assets/';
		this.scene = new THREE.Scene();

		this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
		this.camera.position.set(0, 1.6, 0);

		this.dolly = new THREE.Object3D();
		this.dolly.position.set(0, 0, 10);
		this.dolly.add(this.camera);
		this.scene.add(this.dolly);

		this.dummyCam = new THREE.Object3D();
		this.camera.add(this.dummyCam);

		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.outputEncoding = THREE.sRGBEncoding;
		container.appendChild(this.renderer.domElement);

		// === 🎵 Background Music ===
		const listener = new THREE.AudioListener();
		this.camera.add(listener);

		this.sound = new THREE.Audio(listener);
		const audioLoader = new THREE.AudioLoader();
		audioLoader.load('./assets/bg-music.mp3', (buffer) => {
			this.sound.setBuffer(buffer);
			this.sound.setLoop(true);
			this.sound.setVolume(0.5);
			this.sound.play();
		});

		document.body.addEventListener('click', () => {
			if (!this.sound.isPlaying) this.sound.play();
		}, { once: true });

		// ===

		window.addEventListener('resize', this.resize.bind(this));

		this.scene.add(new THREE.HemisphereLight(0xffffff, 0xaaaaaa, 0.8));
		this.setEnvironment();

		this.stats = new Stats();
		container.appendChild(this.stats.dom);

		this.loadingBar = new LoadingBar();
		this.loadCollege();

		this.clock = new THREE.Clock();
		this.up = new THREE.Vector3(0, 1, 0);
		this.origin = new THREE.Vector3();
		this.workingVec3 = new THREE.Vector3();
		this.workingQuaternion = new THREE.Quaternion();
		this.raycaster = new THREE.Raycaster();
		this.immersive = false;

		fetch('./college.json').then(r => r.json()).then(obj => {
			this.boardData = obj;
			this.boardShown = '';
		});
	}

	setEnvironment() {
		const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
		const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
		pmremGenerator.compileEquirectangularShader();

		loader.load('./assets/hdr/rogland_clear_night_1k.hdr', (texture) => {
			texture.mapping = THREE.EquirectangularReflectionMapping;
			this.scene.background = texture;
			this.scene.environment = pmremGenerator.fromEquirectangular(texture).texture;
			pmremGenerator.dispose();
		});
	}

	resize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	loadCollege() {
		const loader = new GLTFLoader().setPath(this.assetsPath);
		const dracoLoader = new DRACOLoader();
		dracoLoader.setDecoderPath('./libs/three/js/draco/');
		loader.setDRACOLoader(dracoLoader);

		loader.load('college.glb', (gltf) => {
			const model = gltf.scene.children[0];
			this.scene.add(model);

			model.traverse((child) => {
				if (child.isMesh) {
					if (child.name.includes("PROXY")) {
						child.material.visible = false;
						this.proxy = child;
					} else if (child.material.name.includes("Glass")) {
						child.material.opacity = 0.1;
						child.material.transparent = true;
					} else if (child.material.name.includes("SkyBox")) {
						child.visible = false;
					}
				}
			});

			loader.load('MMU.glb', (gltf) => {
				const mmu = gltf.scene;
				this.scene.add(mmu);
			});

			this.loadingBar.visible = false;
			this.setupXR();
		});
	}

	setupXR() {
		this.renderer.xr.enabled = true;
		new VRButton(this.renderer);

		const timeout = setTimeout(() => {
			this.useGaze = true;
			this.gazeController = new GazeController(this.scene, this.dummyCam);
		}, 2000);

		this.controllers = this.buildControllers(this.dolly);
		this.controllers.forEach(ctrl => {
			ctrl.userData.selectPressed = false;
			ctrl.addEventListener('selectstart', () => ctrl.userData.selectPressed = true);
			ctrl.addEventListener('selectend', () => ctrl.userData.selectPressed = false);
			ctrl.addEventListener('connected', () => clearTimeout(timeout));
		});

		const config = {
			panelSize: { height: 0.5 },
			height: 256,
			name: { fontSize: 50, height: 70 },
			info: { position: { top: 70, backgroundColor: "#ccc", fontColor: "#000" } }
		};
		this.ui = new CanvasUI({ name: "name", info: "info" }, config);
		this.scene.add(this.ui.mesh);

		this.renderer.setAnimationLoop(this.render.bind(this));
	}

	buildControllers(parent = this.scene) {
		const factory = new XRControllerModelFactory();
		const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(0, 0, -1)
		]));
		line.scale.z = 0;

		return [0, 1].map(i => {
			const controller = this.renderer.xr.getController(i);
			controller.add(line.clone());
			parent.add(controller);

			const grip = this.renderer.xr.getControllerGrip(i);
			grip.add(factory.createControllerModel(grip));
			parent.add(grip);

			return controller;
		});
	}

	get selectPressed() {
		return this.controllers?.some(c => c.userData.selectPressed);
	}

	moveDolly(dt) {
		if (!this.proxy) return;
		const wallLimit = 1.3;
		const speed = 2;
		let pos = this.dolly.position.clone();
		pos.y += 1;
		const quat = this.dolly.quaternion.clone();
		this.dolly.quaternion.copy(this.dummyCam.getWorldQuaternion(this.workingQuaternion));
		let dir = new THREE.Vector3();
		this.dolly.getWorldDirection(dir).negate();
		this.raycaster.set(pos, dir);
		if (!this.raycaster.intersectObject(this.proxy).some(hit => hit.distance < wallLimit)) {
			this.dolly.translateZ(-dt * speed);
		}
		pos = this.dolly.getWorldPosition(this.origin);
		[-1, 1].forEach(x => {
			dir.set(x, 0, 0).applyMatrix4(this.dolly.matrix).normalize();
			this.raycaster.set(pos, dir);
			const hit = this.raycaster.intersectObject(this.proxy)[0];
			if (hit && hit.distance < wallLimit) {
				this.dolly.translateX(x > 0 ? hit.distance - wallLimit : wallLimit - hit.distance);
			}
		});
		dir.set(0, -1, 0);
		pos.y += 1.5;
		this.raycaster.set(pos, dir);
		const ground = this.raycaster.intersectObject(this.proxy)[0];
		if (ground) this.dolly.position.copy(ground.point);
		this.dolly.quaternion.copy(quat);
	}

	showInfoboard(name, info, pos) {
		if (!this.ui) return;
		this.ui.position.copy(pos).add(this.workingVec3.set(0, 1.3, 0));
		this.ui.lookAt(this.dummyCam.getWorldPosition(this.workingVec3));
		this.ui.updateElement('name', info.name);
		this.ui.updateElement('info', info.info);
		this.ui.update();
		this.ui.visible = true;
		this.boardShown = name;
	}

	render() {
		const dt = this.clock.getDelta();
		if (this.renderer.xr.isPresenting) {
			const moveGaze = this.useGaze && this.gazeController?.mode === GazeController.Modes.MOVE;
			if (this.selectPressed || moveGaze) {
				this.moveDolly(dt);
				if (this.boardData) {
					const dollyPos = this.dolly.getWorldPosition(new THREE.Vector3());
					let found = false;
					for (const [name, info] of Object.entries(this.boardData)) {
						const obj = this.scene.getObjectByName(name);
						if (obj) {
							const pos = obj.getWorldPosition(new THREE.Vector3());
							if (dollyPos.distanceTo(pos) < 3) {
								found = true;
								if (this.boardShown !== name) this.showInfoboard(name, info, pos);
							}
						}
					}
					if (!found) {
						this.boardShown = '';
						this.ui.visible = false;
					}
				}
			}
		}
		if (this.immersive !== this.renderer.xr.isPresenting) {
			this.resize();
			this.immersive = this.renderer.xr.isPresenting;
		}
		this.stats.update();
		this.renderer.render(this.scene, this.camera);
	}
}

export { App };
