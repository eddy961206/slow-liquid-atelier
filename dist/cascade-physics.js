// Small, deterministic viscous-drop simulation in the vessel's local space.
// The render loop supplies the vessel's actual rotation, in radians.
export class CascadePhysics {
  constructor(drops) {
    this.gravity = 1.2;
    this.ramps = Array.from({ length: 6 }, (_, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const a = -side * 0.2;
      return {
        x: -side * 0.19,
        y: 1.52 - i * 0.6,
        tx: Math.cos(a),
        ty: Math.sin(a),
        half: 0.96,
      };
    });
    this.drops = drops.map((drop, index) => ({
      ...drop,
      index,
      vx: 0,
      vy: 0,
      resting: 0,
      stretch: 1,
      baseScale: {
        x: drop.mesh.scale.x,
        y: drop.mesh.scale.y,
        z: drop.mesh.scale.z,
      },
    }));
    this.reset();
  }

  reset() {
    this.time = 0;
    for (const p of this.drops) {
      // Populate every shelf immediately, with stable spacing and depth lanes.
      const shelf = p.index % 6;
      const ramp = this.ramps[shelf];
      const fraction = this.hash(p.index + 13);
      const along = (fraction - 0.5) * 1.65;
      const nx = -ramp.ty,
        ny = ramp.tx;
      p.mesh.position.set(
        ramp.x + ramp.tx * along + nx * (p.r + 0.025),
        ramp.y + ramp.ty * along + ny * (p.r + 0.025),
        (this.hash(p.index + 71) - 0.5) * 0.23,
      );
      p.vx = p.vy = p.resting = 0;
      p.stretch = 1;
      p.mesh.scale.set(p.baseScale.x, p.baseScale.y, p.baseScale.z);
    }
  }

  hash(n) {
    const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  step(dt, angle) {
    if (!Number.isFinite(dt) || !Number.isFinite(angle) || dt <= 0) return;
    const elapsed = Math.min(dt, 0.05);
    const steps = Math.ceil(elapsed / (1 / 120));
    const h = elapsed / steps;
    const gx = -Math.sin(angle) * this.gravity;
    const gy = -Math.cos(angle) * this.gravity;
    for (let s = 0; s < steps; s++) {
      this.time += h;
      for (const p of this.drops) this.advance(p, h, gx, gy);
    }
  }

  advance(p, h, gx, gy) {
    const pos = p.mesh.position;
    p.vx = (p.vx + gx * h) * Math.exp(-0.3 * h);
    p.vy = (p.vy + gy * h) * Math.exp(-0.3 * h);
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 1.05) {
      p.vx *= 1.05 / speed;
      p.vy *= 1.05 / speed;
    }
    pos.x += p.vx * h;
    pos.y += p.vy * h;
    let contact = false;
    for (const ramp of this.ramps) {
      // Closest point on a finite segment handles ends without invisible walls.
      const dx = pos.x - ramp.x,
        dy = pos.y - ramp.y;
      const along = Math.max(
        -ramp.half,
        Math.min(ramp.half, dx * ramp.tx + dy * ramp.ty),
      );
      const ox = dx - ramp.tx * along,
        oy = dy - ramp.ty * along;
      const distance = Math.hypot(ox, oy);
      const clearance = p.r + 0.018;
      if (distance >= clearance) continue;
      let nx, ny;
      if (distance > 0.00001) {
        nx = ox / distance;
        ny = oy / distance;
      } else {
        const direction = gx * -ramp.ty + gy * ramp.tx > 0 ? -1 : 1;
        nx = -ramp.ty * direction;
        ny = ramp.tx * direction;
      }
      pos.x += nx * (clearance - distance);
      pos.y += ny * (clearance - distance);
      this.collide(p, nx, ny, h);
      contact = true;
    }
    const boundX = 1.17 - p.r,
      boundY = 2.5 - p.r;
    if (pos.x > boundX) {
      pos.x = boundX;
      this.collide(p, -1, 0, h);
      contact = true;
    }
    if (pos.x < -boundX) {
      pos.x = -boundX;
      this.collide(p, 1, 0, h);
      contact = true;
    }
    if (pos.y > boundY) {
      pos.y = boundY;
      this.collide(p, 0, -1, h);
      contact = true;
    }
    if (pos.y < -boundY) {
      pos.y = -boundY;
      this.collide(p, 0, 1, h);
      contact = true;
    }

    // Only transfer behind the opaque end-basin covers, never between shelves.
    // Both ends work as the collecting basin when the vessel is inverted.
    const collecting = Math.abs(gy) > 1.05 && pos.y * Math.sign(gy) > 2.2;
    p.resting = collecting ? p.resting + h : 0;
    if (p.resting > 2.5 + this.hash(p.index + 31) * 3) {
      const direction = Math.sign(gy);
      pos.y = -direction * (2.5 - p.r - 0.015);
      pos.x = (this.hash(p.index + 97) - 0.5) * 0.65;
      p.vx = p.vy = p.resting = 0;
      contact = true;
    }

    // Gentle volume-preserving deformation, without opacity or emission pulses.
    const target = contact
      ? 0.86
      : 1 + Math.min(0.27, Math.hypot(p.vx, p.vy) * 0.28);
    p.stretch += (target - p.stretch) * (1 - Math.exp(-7 * h));
    const width = 1 / Math.sqrt(p.stretch);
    p.mesh.scale.set(
      p.baseScale.x * width,
      p.baseScale.y * p.stretch,
      p.baseScale.z * width,
    );
  }

  collide(p, nx, ny, h) {
    const normalSpeed = p.vx * nx + p.vy * ny;
    if (normalSpeed < 0) {
      p.vx -= normalSpeed * 1.015 * nx;
      p.vy -= normalSpeed * 1.015 * ny;
    }
    const tangentSpeed = -p.vx * ny + p.vy * nx;
    const loss = 1 - Math.exp(-0.65 * h);
    p.vx += tangentSpeed * ny * loss;
    p.vy -= tangentSpeed * nx * loss;
  }
}
