'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { AgentSummary, CityInfo } from '@/lib/types';

const RADIUS = 1;
const DEG = Math.PI / 180;

/** Latitude/longitude to a point on the sphere. */
function toVector(lat: number, lon: number, radius = RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

export interface GlobeProps {
  cities: CityInfo[];
  agents: AgentSummary[];
  selectedCityId?: string | null;
  onSelectCity?: (cityId: string | null) => void;
}

/**
 * The world, as an object you can turn.
 *
 * Deliberately not a textured Earth: Epoch simulates cities and the people in
 * them, not terrain, so the globe shows exactly what the simulation knows —
 * a dotted sphere for scale, real coordinates for every city, and an arc for
 * every agent currently in the air. Nothing on screen is decorative geography.
 */
export function Globe({ cities, agents, selectedCityId, onSelectCity }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    globe: THREE.Group;
    markers: THREE.Group;
    arcs: THREE.Group;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    dispose: () => void;
  } | null>(null);

  const dataRef = useRef({ cities, agents, selectedCityId });
  dataRef.current = { cities, agents, selectedCityId };

  // ── Scene setup: runs once ────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 1.26, 3.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);

    const globe = new THREE.Group();
    scene.add(globe);

    // The body of the planet: near-black, so city lights read against it.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 0.995, 64, 64),
      new THREE.MeshBasicMaterial({ color: 0x0b1018 }),
    );
    globe.add(body);

    // A Fibonacci lattice of points across the surface — gives the sphere its
    // form and a sense of rotation without pretending to be a map.
    const lattice = 2600;
    const dotPositions = new Float32Array(lattice * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < lattice; i++) {
      const y = 1 - (i / (lattice - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      dotPositions.set([Math.cos(theta) * r * RADIUS, y * RADIUS, Math.sin(theta) * r * RADIUS], i * 3);
    }
    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3));
    globe.add(
      new THREE.Points(
        dotGeometry,
        new THREE.PointsMaterial({ color: 0x2f4a63, size: 0.008, sizeAttenuation: true, transparent: true, opacity: 0.75 }),
      ),
    );

    // Graticule — equator and tropics read heavier than the rest.
    const graticule = new THREE.Group();
    for (let lat = -60; lat <= 60; lat += 30) {
      const points: THREE.Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 3) points.push(toVector(lat, lon, RADIUS * 1.001));
      graticule.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0x1c3348, transparent: true, opacity: lat === 0 ? 0.9 : 0.4 }),
        ),
      );
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 3) points.push(toVector(lat, lon, RADIUS * 1.001));
      graticule.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0x1c3348, transparent: true, opacity: 0.35 }),
        ),
      );
    }
    globe.add(graticule);

    // Atmosphere: a back-faced shell with a Fresnel falloff, which is what
    // gives the planet its rim light.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 1.09, 64, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(0x3987e5) } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          void main() {
            float intensity = pow(0.60 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0) * 1.15;
            gl_FragColor = vec4(uColor, 1.0) * intensity;
          }
        `,
      }),
    );
    scene.add(atmosphere);

    // A quiet starfield so the globe sits in something rather than floating.
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const radius = 14 + Math.random() * 22;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions.set(
        [
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.sin(phi) * Math.sin(theta),
          radius * Math.cos(phi),
        ],
        i * 3,
      );
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    scene.add(
      new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.055, transparent: true, opacity: 0.5 }),
      ),
    );

    const markers = new THREE.Group();
    const arcs = new THREE.Group();
    globe.add(markers, arcs);

    // ── Interaction ─────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.03 };
    const pointer = new THREE.Vector2();

    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let velocity = 0.0009;
    let targetTilt = 0.32;
    let tilt = 0.32;
    // At fov 38 the visible height is 2*d*tan(19deg); the atmosphere shell is
    // 2.32 across, so anything under ~3.4 clips the planet against the panel.
    let distance = 4.0;
    let targetDistance = 4.0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      globe.rotation.y += dx * 0.005;
      targetTilt = Math.max(-1.1, Math.min(1.1, targetTilt + dy * 0.004));
      lastX = event.clientX;
      lastY = event.clientY;
      velocity = dx * 0.0004;
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      // A click that didn't drag is a selection.
      if (!moved && onSelectCity) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(markers.children, false);
        const cityId = hits[0]?.object.userData.cityId as string | undefined;
        onSelectCity(cityId ?? null);
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      targetDistance = Math.max(2.4, Math.min(8, targetDistance + event.deltaY * 0.0016));
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // ── Sizing ──────────────────────────────────────────────────────────────
    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      if (clientWidth === 0 || clientHeight === 0) return;
      // updateStyle is false because the canvas is sized by CSS below; without
      // pinning that style the element would render at its device-pixel buffer
      // size and the globe would appear magnified by the pixel ratio.
      renderer.setSize(clientWidth, clientHeight, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    // ── Frame loop ──────────────────────────────────────────────────────────
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let elapsed = 0;

    const render = () => {
      frame = requestAnimationFrame(render);
      elapsed += 0.016;

      if (!dragging) {
        // Ease back to a slow idle spin after a drag.
        velocity += (0.0009 - velocity) * 0.02;
        if (!reduceMotion) globe.rotation.y += velocity;
      }

      tilt += (targetTilt - tilt) * 0.08;
      distance += (targetDistance - distance) * 0.08;
      camera.position.set(0, Math.sin(tilt) * distance, Math.cos(tilt) * distance);
      camera.lookAt(0, 0, 0);
      atmosphere.position.copy(globe.position);

      // Markers breathe very slightly so a still world still feels alive.
      const breath = reduceMotion ? 1 : 1 + Math.sin(elapsed * 1.6) * 0.06;
      for (const marker of markers.children) {
        const base = (marker.userData.scale as number) ?? 1;
        const selected = marker.userData.cityId === dataRef.current.selectedCityId;
        marker.scale.setScalar(base * (selected ? 1.5 : 1) * breath);
      }

      // Agents in flight travel along their arc in real time.
      for (const arc of arcs.children) {
        const line = arc as THREE.Line;
        const material = line.material as THREE.LineBasicMaterial;
        material.opacity = 0.35 + Math.sin(elapsed * 2 + (line.userData.phase as number)) * 0.2;
      }

      renderer.render(scene, camera);
    };
    render();

    const dispose = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };

    stateRef.current = { scene, camera, renderer, globe, markers, arcs, raycaster, pointer, dispose };
    return dispose;
    // Setup runs once; data changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── City markers: rebuilt when the population moves ───────────────────────
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    const { markers } = state;
    for (const child of [...markers.children]) {
      markers.remove(child);
      (child as THREE.Mesh).geometry.dispose();
      ((child as THREE.Mesh).material as THREE.Material).dispose();
    }

    const maxResidents = Math.max(1, ...cities.map((c) => c.residents));

    for (const city of cities) {
      if (city.residents === 0) continue;

      // Colour carries mood; size carries how many people live there.
      const hue = 0.58 - city.mood * 0.16;
      const color = new THREE.Color().setHSL(hue, 0.75, 0.5 + city.mood * 0.12);
      const scale = 0.009 + (city.residents / maxResidents) * 0.016;

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      );
      marker.position.copy(toVector(city.lat, city.lon, RADIUS * 1.012));
      marker.scale.setScalar(scale);
      marker.userData = { cityId: city.id, scale };
      markers.add(marker);

      // A short spike upward reads as a settlement rather than a dot.
      const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0016, 0.0016, 0.05 + (city.residents / maxResidents) * 0.09, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
      );
      const base = toVector(city.lat, city.lon, RADIUS * 1.0);
      spike.position.copy(toVector(city.lat, city.lon, RADIUS * 1.03));
      spike.lookAt(0, 0, 0);
      spike.rotateX(Math.PI / 2);
      spike.userData = { cityId: city.id, scale: 1 };
      void base;
      markers.add(spike);
    }
  }, [cities]);

  // ── Flight arcs: one per agent currently in the air ───────────────────────
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    const { arcs } = state;
    for (const child of [...arcs.children]) {
      arcs.remove(child);
      (child as THREE.Line).geometry.dispose();
      ((child as THREE.Line).material as THREE.Material).dispose();
    }

    const inFlight = agents.filter((agent) => agent.flight);
    for (const [index, agent] of inFlight.entries()) {
      const from = toVector(agent.lat, agent.lon, RADIUS * 1.01);
      const to = toVector(agent.flight!.toLat, agent.flight!.toLon, RADIUS * 1.01);

      // Lift the arc's midpoint in proportion to the distance flown, so a
      // London–Tokyo hop visibly leaves the atmosphere and a short hop doesn't.
      const separation = from.distanceTo(to);
      const mid = from.clone().add(to).multiplyScalar(0.5).normalize().multiplyScalar(RADIUS * (1 + separation * 0.35));
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
        new THREE.LineBasicMaterial({ color: 0xc98500, transparent: true, opacity: 0.5 }),
      );
      line.userData = { phase: index * 0.7 };
      arcs.add(line);
    }
  }, [agents]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 cursor-grab active:cursor-grabbing"
      role="img"
      aria-label={`Globe showing ${cities.filter((c) => c.residents > 0).length} inhabited cities and ${
        agents.filter((a) => a.flight).length
      } agents in flight`}
    />
  );
}
