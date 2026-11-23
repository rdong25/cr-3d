// Baked inverse kinematics for held props (musket, bow).
//
// Hand-typed joint angles can't make two hands meet on a prop: the result is a
// gun waved in one fist. Instead a pose says where the PROP should be, in the
// chest's local space (so it follows every lean, twist and recoil of the body):
//
//   prop: { grip: [x, y, z], dir: [x, y, z], up?: [x, y, z] }   main hand + aim
//   support: number | [x, y, z]                                  off hand
//
// and this module solves both arms per frame: forward kinematics for the body,
// analytic two-bone IK for each arm, and the main hand's rotation so the prop
// points along `dir`. Results come back as quaternions the clip baker stores
// directly. Targets beyond arm's reach are clamped (the arm straightens toward
// them), which matters with these short stylized arms.

import * as THREE from 'three'

const V = (a) => new THREE.Vector3(a[0], a[1], a[2])

/** A posable copy of the skeleton, for forward kinematics while baking. */
export function makeRig(BONES) {
  const bones = new Map(), rest = new Map()
  for (const b of BONES) { const bone = new THREE.Bone(); bone.name = b.name; bones.set(b.name, bone); rest.set(b.name, V(b.pos)) }
  let root = null
  for (const b of BONES) {
    const bone = bones.get(b.name)
    if (b.parent) { bone.position.copy(rest.get(b.name)).sub(rest.get(b.parent)); bones.get(b.parent).add(bone) }
    else { bone.position.copy(rest.get(b.name)); root = bone }
  }
  const restLocal = new Map([...bones].map(([k, v]) => [k, v.position.clone()]))
  const e = new THREE.Euler()
  return {
    bones, rest,
    /** Apply a pose's Euler angles and position offsets, then update world matrices. */
    apply(pose) {
      for (const [name, bone] of bones) {
        const r = pose[name]
        if (r && r.q) bone.quaternion.set(r.q[0], r.q[1], r.q[2], r.q[3])
        else { const a = r || [0, 0, 0]; bone.quaternion.setFromEuler(e.set(a[0], a[1], a[2], 'XYZ')) }
        const d = pose.pos && pose.pos[name]
        bone.position.copy(restLocal.get(name))
        if (d) bone.position.add(V(d))
      }
      root.updateMatrixWorld(true)
    },
    worldPos: (name) => new THREE.Vector3().setFromMatrixPosition(bones.get(name).matrixWorld),
    worldQuat: (name) => bones.get(name).getWorldQuaternion(new THREE.Quaternion()),
    toWorld: (name, local) => V(local).applyMatrix4(bones.get(name).matrixWorld),
    dirToWorld: (name, local) => V(local).applyQuaternion(bones.get(name).getWorldQuaternion(new THREE.Quaternion())).normalize(),
  }
}

/**
 * Bend one arm so its wrist reaches `wristTarget` (world space).
 * Writes quaternions for upperarm_<side> and forearm_<side> into `pose`.
 * `pole` (world direction) says which way the elbow points.
 * Returns the forearm's world quaternion and where the wrist actually ended up.
 */
export function solveArm(rig, pose, side, wristTarget, pole) {
  const up = `upperarm_${side}`, fo = `forearm_${side}`, ha = `hand_${side}`
  const S0 = rig.rest.get(up), E0 = rig.rest.get(fo), W0 = rig.rest.get(ha)
  const l1 = E0.distanceTo(S0), l2 = W0.distanceTo(E0)
  const S = rig.worldPos(up)
  const to = wristTarget.clone().sub(S)
  const dist = Math.min(to.length(), (l1 + l2) * 0.999)
  const n = to.clone().normalize()
  // Law of cosines: distance from the shoulder to the elbow's foot on the S->W line.
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const bend = pole.clone().addScaledVector(n, -pole.dot(n))
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(n, n.y)
  bend.normalize()
  const E = S.clone().addScaledVector(n, a).addScaledVector(bend, h)
  const W = S.clone().addScaledVector(n, dist)
  const parentQ = rig.bones.get(up).parent.getWorldQuaternion(new THREE.Quaternion())
  const u0 = E0.clone().sub(S0).normalize(), f0 = W0.clone().sub(E0).normalize()
  const qU = new THREE.Quaternion().setFromUnitVectors(u0, E.clone().sub(S).normalize().applyQuaternion(parentQ.clone().invert()))
  const upperWorld = parentQ.clone().multiply(qU)
  const qF = new THREE.Quaternion().setFromUnitVectors(f0, W.clone().sub(E).normalize().applyQuaternion(upperWorld.clone().invert()))
  pose[up] = { q: qU.toArray() }
  pose[fo] = { q: qF.toArray() }
  return { forearmWorld: upperWorld.multiply(qF), wrist: W }
}

/** Rotation taking the prop's bind-pose frame (dir0, up0) to a target frame (dir, up). */
function frameRotation(dir0, up0, dir, up) {
  const basis = (d, u) => {
    const x = d.clone().normalize()
    const z = new THREE.Vector3().crossVectors(x, u).normalize()
    const y = new THREE.Vector3().crossVectors(z, x)
    return new THREE.Matrix4().makeBasis(x, y, z)
  }
  const m = basis(dir, up).multiply(basis(dir0, up0).transpose())
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

/**
 * Pose both arms around a prop held in `mainSide`'s hand.
 *
 * @param spec.gripRest   grip point in the bind pose (model space)
 * @param spec.dirRest    the prop's pointing direction in the bind pose
 * @param spec.upRest     the prop's "top" in the bind pose (default: world up)
 * @param spec.handLen    wrist-to-palm distance used to land the off hand on the prop
 * pose.prop = { grip, dir, up? } in CHEST space; pose.support = distance along
 * `dir` from the grip where the off hand holds, or an explicit chest-space point.
 */
export function holdProp(rig, pose, mainSide, spec) {
  const offSide = mainSide === 'R' ? 'L' : 'R'
  const body = { ...pose }
  rig.apply(body)
  const prop = pose.prop
  const grip = rig.toWorld('chest', prop.grip)
  const dir = rig.dirToWorld('chest', prop.dir)
  const up = rig.dirToWorld('chest', prop.up || [0, 1, 0])
  const R = frameRotation(V(spec.dirRest), V(spec.upRest || [0, 1, 0]), dir, up)
  // Wrist = grip minus the (rotated) bind-pose offset from wrist to grip.
  const wristRest = rig.rest.get(`hand_${mainSide}`)
  const wrist = grip.clone().sub(V(spec.gripRest).sub(wristRest).applyQuaternion(R))
  const sx = mainSide === 'R' ? -1 : 1
  const main = solveArm(rig, body, mainSide, wrist, new THREE.Vector3(sx * 0.7, -1, -0.35))
  // The hand takes whatever rotation makes the prop point along `dir`.
  body[`hand_${mainSide}`] = { q: main.forearmWorld.clone().invert().multiply(R).toArray() }
  // Off hand: a point along the prop (moved with the wrist if the main arm was out of reach).
  const shift = main.wrist.clone().sub(wrist)
  let target
  if (Array.isArray(pose.support)) target = rig.toWorld('chest', pose.support)
  else target = grip.clone().add(shift).addScaledVector(dir, pose.support ?? 0.3).addScaledVector(up, -0.03)
  const S = rig.worldPos(`upperarm_${offSide}`)
  const wristOff = target.clone().addScaledVector(target.clone().sub(S).normalize(), -(spec.handLen ?? 0.07))
  solveArm(rig, body, offSide, wristOff, new THREE.Vector3(-sx * 0.7, -1, -0.2))
  body[`hand_${offSide}`] = pose[`hand_${offSide}`] && !pose[`hand_${offSide}`].q ? pose[`hand_${offSide}`] : [0, 0, 0]
  delete body.prop; delete body.support
  return body
}
