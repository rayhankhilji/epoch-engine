'use client';

import { useEffect, useRef, useState } from 'react';
import type { GraphData } from '@/lib/types';
import { Empty } from './ui';

interface Node {
  id: string;
  name: string;
  occupation: string;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/**
 * The society, as a shape.
 *
 * A force-directed layout on a canvas — cheap enough to run every frame for a
 * few hundred people, and the only view that makes cliques, brokers and
 * isolates visible at a glance. Edge colour carries the sign of the
 * relationship: warm for affection, red for hostility.
 */
export function RelationshipGraph({
  data,
  selectedId,
  onSelect,
}: {
  data: GraphData;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ name: string; occupation: string; degree: number; x: number; y: number } | null>(null);

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.nodes.length === 0) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;

    const maxDegree = Math.max(1, ...data.nodes.map((n) => n.degree));

    // Seed positions on a circle rather than at random: the layout settles
    // faster and, more importantly, settles the same way every time.
    const nodes: Node[] = data.nodes.map((node, index) => {
      const angle = (index / data.nodes.length) * Math.PI * 2;
      return {
        id: node.id,
        name: node.name,
        occupation: node.occupation,
        degree: node.degree,
        x: width / 2 + Math.cos(angle) * Math.min(width, height) * 0.3,
        y: height / 2 + Math.sin(angle) * Math.min(width, height) * 0.3,
        vx: 0,
        vy: 0,
        radius: 3 + (node.degree / maxDegree) * 6,
      };
    });

    const byId = new Map(nodes.map((node) => [node.id, node]));
    // Spread first, then resolve: the other way round, the raw string ids from
    // `edge` overwrite the node references we just looked up.
    const edges = data.edges
      .map((edge) => ({ ...edge, source: byId.get(edge.source), target: byId.get(edge.target) }))
      .filter((edge): edge is typeof edge & { source: Node; target: Node } => Boolean(edge.source && edge.target));

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frame = 0;
    let alpha = 1;

    const step = () => {
      frame = requestAnimationFrame(step);

      // Cool the simulation down so it comes to rest instead of jittering.
      alpha = Math.max(0, alpha - 0.004);

      if (alpha > 0.001) {
        // Repulsion — O(n²), fine at these population sizes.
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i]!;
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distanceSq = dx * dx + dy * dy || 1;
            const force = (900 * alpha) / distanceSq;
            const distance = Math.sqrt(distanceSq);
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
          }
        }

        // Attraction along ties, proportional to their strength.
        for (const edge of edges) {
          const dx = edge.target.x - edge.source.x;
          const dy = edge.target.y - edge.source.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (distance - 70) * 0.0025 * edge.strength * alpha;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          edge.source.vx += fx;
          edge.source.vy += fy;
          edge.target.vx -= fx;
          edge.target.vy -= fy;
        }

        for (const node of nodes) {
          // Gentle pull to centre keeps isolates from drifting off-screen.
          node.vx += (width / 2 - node.x) * 0.0016 * alpha;
          node.vy += (height / 2 - node.y) * 0.0016 * alpha;
          node.vx *= 0.85;
          node.vy *= 0.85;
          node.x = Math.max(node.radius, Math.min(width - node.radius, node.x + node.vx));
          node.y = Math.max(node.radius, Math.min(height - node.radius, node.y + node.vy));
        }
      }

      // ── Draw ──────────────────────────────────────────────────────────────
      context.clearRect(0, 0, width, height);

      for (const edge of edges) {
        const hostile = edge.affinity < -0.15;
        context.strokeStyle = hostile
          ? `rgba(208, 59, 59, ${0.15 + edge.strength * 0.5})`
          : `rgba(57, 135, 229, ${0.1 + edge.strength * 0.45})`;
        context.lineWidth = 0.5 + edge.strength * 1.5;
        context.beginPath();
        context.moveTo(edge.source.x, edge.source.y);
        context.lineTo(edge.target.x, edge.target.y);
        context.stroke();
      }

      for (const node of nodes) {
        const selected = node.id === selectedRef.current;

        // A 2px surface ring separates overlapping marks.
        context.beginPath();
        context.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
        context.fillStyle = '#131313';
        context.fill();

        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = selected ? '#ffffff' : '#3987e5';
        context.fill();

        if (selected) {
          context.strokeStyle = 'rgba(255,255,255,0.4)';
          context.lineWidth = 1.5;
          context.beginPath();
          context.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
          context.stroke();
        }
      }

      // Only the best-connected few are labelled — a label on every node is
      // noise, and these are the ones worth naming.
      context.font = '10px system-ui, sans-serif';
      context.fillStyle = '#898781';
      context.textAlign = 'center';
      for (const node of [...nodes].sort((a, b) => b.degree - a.degree).slice(0, 6)) {
        context.fillText(node.name.split(' ')[0]!, node.x, node.y - node.radius - 6);
      }
    };
    step();

    const findNode = (event: PointerEvent): Node | undefined => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return nodes.find((node) => Math.hypot(node.x - x, node.y - y) < node.radius + 6);
    };

    const onMove = (event: PointerEvent) => {
      const node = findNode(event);
      setHovered(
        node
          ? { name: node.name, occupation: node.occupation, degree: node.degree, x: node.x, y: node.y }
          : null,
      );
      canvas.style.cursor = node ? 'pointer' : 'default';
    };

    const onClick = (event: PointerEvent) => {
      const node = findNode(event);
      if (node && onSelect) onSelect(node.id);
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onClick);
    canvas.addEventListener('pointerleave', () => setHovered(null));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onClick);
    };
  }, [data, onSelect]);

  if (data.nodes.length === 0) return <Empty>Nobody knows anybody yet.</Empty>;

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" aria-label={`Relationship graph: ${data.nodes.length} people, ${data.edges.length} ties`} />

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-hairline bg-raised px-2 py-1.5 text-[11px] shadow-lg"
          style={{ left: hovered.x, top: hovered.y - 12 }}
        >
          <div className="whitespace-nowrap text-ink">{hovered.name}</div>
          <div className="whitespace-nowrap text-ink-muted">
            {hovered.occupation} · {hovered.degree} ties
          </div>
        </div>
      )}

      {/* Colour carries the sign of a relationship, so it needs a key. */}
      <div className="pointer-events-none absolute bottom-2 left-3 flex gap-3 text-[10px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: 'var(--color-series-1)' }} />
          warm
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: 'var(--color-critical)' }} />
          hostile
        </span>
      </div>
    </div>
  );
}
