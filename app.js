// VR scene with keyboard and mouse movement support
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
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
        this.camera.position.set(0, 1.6, 0);

        this.dolly = new THREE.Object3D();
        this.dolly.position.set(0, 0, 10);
        this.dolly.add(this.camera);

        this.dummyCam = new THREE.Object3D();
        this.camera.add(this.dummyCam);

        this.scene = new THREE.Scene();
        this.scene.add(this.dolly);

        const ambient = new THREE.HemisphereLight(0xFFFFFF, 0xAAAAAA, 0.8);
        this.scene.add(ambient);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        container.appendChild(this.renderer.domElement);

        this.setEnvironment();
        window.addEventListener('resize', this.resize.bind(this));

        this.clock = new THREE.Clock();
        this.raycaster = new THREE.Raycaster();
        this.workingVec3 = new THREE.Vector3();
        this.workingQuaternion = new THREE.Quaternion();

        this.stats = new Stats();
        container.appendChild(this.stats.dom);

        this.loadingBar = new LoadingBar();
        this.loadCollege();

        this.immersive = false;

        this.moveInput = { forward: false, backward: false, left: false, right: false };
        this.initKeyboardControls();
        this.initMouseLook();

        fetch('./college.json')
            .then(response => response.json())
            .then(obj => {
                this.boardShown = '';
                this.boardData = obj;
            });
    }

    initKeyboardControls() {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (key === 'w') this.moveInput.forward = true;
            if (key === 's') this.moveInput.backward = true;
            if (key === 'a') this.moveInput.left = true;
            if (key === 'd') this.moveInput.right = true;
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (key === 'w') this.moveInput.forward = false;
            if (key === 's') this.moveInput.backward = false;
            if (key === 'a') this.moveInput.left = false;
            if (key === 'd') this.moveInput.right = false;
        });
    }

    initMouseLook() {
        this.yaw = 0;
        this.pitch = 0;
        this.mouseSensitivity = 0.002;

        window.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement) {
                this.yaw -= e.movementX * this.mouseSensitivity;
                this.pitch -= e.movementY * this.mouseSensitivity;
                this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

                this.dummyCam.rotation.set(this.pitch, this.yaw, 0);
            }
        });

        window.addEventListener('click', () => {
            if (!document.pointerLockElement) {
                this.renderer.domElement.requestPointerLock();
            }
        });
    }

    setEnvironment() {
        const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        loader.load('./assets/hdr/venice_sunset_1k.hdr', (texture) => {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            pmremGenerator.dispose();
            this.scene.environment = envMap;
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
            const college = gltf.scene.children[0];
            this.scene.add(college);

            college.traverse((child) => {
                if (child.isMesh) {
                    if (child.name.includes('PROXY')) {
                        child.material.visible = false;
                        this.proxy = child;
                    }
                }
            });

            this.loadingBar.visible = false;
            this.setupXR();
        });
    }

    setupXR() {
        this.renderer.xr.enabled = true;
        document.body.appendChild(VRButton.createButton(this.renderer));
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    moveDolly(dt) {
        const speed = 2;
        const direction = new THREE.Vector3();

        if (this.moveInput.forward) direction.z -= 1;
        if (this.moveInput.backward) direction.z += 1;
        if (this.moveInput.left) direction.x -= 1;
        if (this.moveInput.right) direction.x += 1;

        if (direction.lengthSq() > 0) {
            direction.normalize().applyQuaternion(this.dummyCam.quaternion);
            this.dolly.position.addScaledVector(direction, speed * dt);
        }
    }

    render() {
        const dt = this.clock.getDelta();
        this.moveDolly(dt);
        this.stats.update();
        this.renderer.render(this.scene, this.camera);
    }
}

export { App };
