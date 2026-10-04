import { Rng } from '../core/rng';
import { Ball } from '../sim/ball';
import { AssistState } from '../sim/dribble';
import { HumanCtl, Match } from '../sim/match';
import { Player } from '../sim/player';
import { SkillState } from '../sim/skills';
import { FunTracker } from './funLayer';
import { MatchTally } from './ratings';

// A local football snapshot is an object graph, not a render frame. In particular bySide, the current HumanCtl,
// team definitions and FunTracker must still share their original objects after recovery.
const CLASSES = { Match, Player, Ball, Rng, HumanCtl, AssistState, SkillState, FunTracker, MatchTally };
type ClassName = keyof typeof CLASSES;
type Atom = string | number | boolean | null | { ref: number } | { special: 'undefined' | 'NaN' | 'Infinity' | '-Infinity' | '-0' };
interface Node { kind: 'object' | 'array' | 'map' | 'set' | ClassName; entries: [string | Atom, Atom][] }
export interface StateGraph { version: 1; root: Atom; nodes: Node[] }
const MAX_NODES = 12_000;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Preserve exact numeric values, maps, sets, class methods and shared references; never serialize functions. */
export function encodeState(value: unknown): StateGraph {
  const nodes: Node[] = [];
  const ids = new Map<object, number>();
  const atom = (v: unknown): Atom => {
    if (v === undefined) return { special: 'undefined' };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { special: 'NaN' };
      if (!Number.isFinite(v)) return { special: v > 0 ? 'Infinity' : '-Infinity' };
      return Object.is(v, -0) ? { special: '-0' } : v;
    }
    if (typeof v !== 'object') throw new Error('Non-state value in match recovery');
    const old = ids.get(v);
    if (old !== undefined) return { ref: old };
    if (nodes.length >= MAX_NODES) throw new Error('Match recovery exceeds its state limit');
    const id = nodes.length;
    ids.set(v, id);
    const proto = Object.getPrototypeOf(v);
    const cls = (Object.keys(CLASSES) as ClassName[]).find(k => proto === CLASSES[k].prototype);
    const kind = Array.isArray(v) ? 'array' : v instanceof Map ? 'map' : v instanceof Set ? 'set' : cls ?? 'object';
    if (kind === 'object' && proto !== Object.prototype && proto !== null) throw new Error('Unknown match state class');
    const node: Node = { kind, entries: [] };
    nodes.push(node);
    if (v instanceof Map) node.entries = [...v].map(([k, x]) => [atom(k), atom(x)]);
    else if (v instanceof Set) node.entries = [...v].map((x, i) => [String(i), atom(x)]);
    else if (Array.isArray(v)) node.entries = Array.from(v, (x, i) => [String(i), atom(x)]);
    else node.entries = Object.entries(v).map(([k, x]) => {
      if (BAD_KEYS.has(k)) throw new Error('Unsafe state property');
      return [k, atom(x)];
    });
    return { ref: id };
  };
  return { version: 1, root: atom(value), nodes };
}

/** Only known game prototypes are allowed. Existing roots keep renderer callbacks bound to the live match. */
export function decodeState<T>(graph: StateGraph, existing: Partial<Record<ClassName, object>> = {}): T {
  if (graph?.version !== 1 || !Array.isArray(graph.nodes) || graph.nodes.length > MAX_NODES) throw new Error('Invalid recovery graph');
  const used = new Set<ClassName>();
  let entries = 0;
  const objects = graph.nodes.map(node => {
    if (!node || !Array.isArray(node.entries) || (entries += node.entries.length) > 150_000) throw new Error('Invalid state node');
    if (node.kind === 'array') return [];
    if (node.kind === 'map') return new Map();
    if (node.kind === 'set') return new Set();
    if (node.kind === 'object') return {};
    if (!Object.hasOwn(CLASSES, node.kind)) throw new Error('Unknown recovery class');
    const name = node.kind as ClassName;
    if (existing[name] && !used.has(name)) { used.add(name); return existing[name]; }
    return Object.create(CLASSES[name].prototype) as object;
  });
  const atom = (v: Atom): unknown => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object' || Object.keys(v).length !== 1) throw new Error('Invalid state atom');
    if ('ref' in v) {
      if (!Number.isInteger(v.ref) || v.ref < 0 || v.ref >= objects.length) throw new Error('Invalid state reference');
      return objects[v.ref];
    }
    if ('special' in v) {
      switch (v.special) {
        case 'undefined': return undefined;
        case 'NaN': return NaN;
        case 'Infinity': return Infinity;
        case '-Infinity': return -Infinity;
        case '-0': return -0;
      }
    }
    throw new Error('Unknown state atom');
  };
  // Validate all entries before writing into any live object.
  for (const node of graph.nodes) {
    for (const pair of node.entries) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid state entry');
      const [k, v] = pair;
      atom(v);
      if (node.kind === 'map') atom(k as Atom);
      else if (typeof k !== 'string' || BAD_KEYS.has(k) || k.length > 200) throw new Error('Invalid state key');
      if (node.kind === 'array' && !/^(0|[1-9]\d*)$/.test(String(k))) throw new Error('Invalid array index');
    }
  }
  graph.nodes.forEach((node, i) => {
    const target = objects[i];
    for (const [k, v] of node.entries) {
      if (target instanceof Map) target.set(atom(k as Atom), atom(v));
      else if (target instanceof Set) target.add(atom(v));
      else Object.defineProperty(target, k as string, { value: atom(v), writable: true, enumerable: true, configurable: true });
    }
  });
  return atom(graph.root) as T;
}
