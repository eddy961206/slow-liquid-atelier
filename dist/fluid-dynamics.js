// Stateful thermal convection for the lava vessel; no clock-driven trajectories.
export class ConvectionSystem {
  constructor(count = 9) {
    this.nodes = [];
    this.lastEnergy = 0;
    for (let i = 0; i < count; i++) {
      this.nodes.push({
        x: 0.5,
        y: 0.2,
        z: 0.5,
        strength: 0.5,
        vx: 0,
        vy: 0,
        vz: 0,
        temperature: 0,
        phase: 1,
        targetX: 0.5,
        targetZ: 0.5,
        driftTime: 0,
        thermalRate: 0,
        hotThreshold: 0,
        coldThreshold: 0,
      });
    }
    this.reset();
  }

  reset() {
    this.lastEnergy = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.025 + Math.random() * 0.06;
      n.x = 0.5 + Math.cos(angle) * radius;
      n.z = 0.5 + Math.sin(angle) * radius;
      n.y = 0.22 + (0.53 * (i + Math.random() * 0.7)) / this.nodes.length;
      n.strength = 0.19 + Math.random() * 0.13;
      n.phase = i % 2 ? -1 : 1;
      n.temperature =
        n.phase > 0 ? 0.66 + Math.random() * 0.18 : 0.19 + Math.random() * 0.2;
      n.vx = (Math.random() - 0.5) * 0.004;
      n.vz = (Math.random() - 0.5) * 0.004;
      n.vy = n.phase * (0.007 + Math.random() * 0.01);
      n.thermalRate = 0.055 + Math.random() * 0.035;
      n.hotThreshold = 0.63 + Math.random() * 0.09;
      n.coldThreshold = 0.28 + Math.random() * 0.09;
      this.chooseDrift(n);
    }
  }

  chooseDrift(n) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * 0.085;
    n.targetX = 0.5 + Math.cos(angle) * radius;
    n.targetZ = 0.5 + Math.sin(angle) * radius;
    n.driftTime = 3 + Math.random() * 8;
  }

  kick(strength = 1) {
    for (const n of this.nodes) {
      n.vy += strength * 0.017 * (1 - 0.4 * n.y);
      n.vx += (Math.random() - 0.5) * strength * 0.012;
      n.vz += (Math.random() - 0.5) * strength * 0.012;
    }
  }

  step(dt, energy = 0) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    energy = Number.isFinite(energy) ? Math.max(0, Math.min(energy, 1)) : 0;
    const kick = Math.max(0, energy - this.lastEnergy);
    this.lastEnergy = energy;
    if (kick > 0) this.kick(kick);
    // Ignore suspension-sized wall-clock gaps instead of fast-forwarding the lamp.
    const duration = Math.min(dt, 0.25);
    const steps = Math.ceil(duration / 0.01);
    const h = duration / steps;
    const damping = Math.exp(-1.25 * h);
    for (let s = 0; s < steps; s++) {
      for (const n of this.nodes) {
        n.driftTime -= h;
        if (n.driftTime <= 0) this.chooseDrift(n);
        // Wax retains heat in transit; heating/cooling is strongest at the ends.
        const heat = Math.max(0, (0.4 - n.y) / 0.2);
        const cool = Math.max(0, (n.y - 0.57) / 0.22);
        n.temperature +=
          h *
          n.thermalRate *
          (heat * (1.12 - n.temperature) - cool * (n.temperature + 0.12));
        n.temperature = Math.max(0, Math.min(1, n.temperature));
        if (n.temperature > n.hotThreshold) n.phase = 1;
        else if (n.temperature < n.coldThreshold) n.phase = -1;
        const buoyancy = (n.temperature - 0.5) * 0.045 + n.phase * 0.008;
        n.vy = (n.vy + buoyancy * h) * damping;
        n.vx = (n.vx + (n.targetX - n.x) * 0.055 * h) * damping;
        n.vz = (n.vz + (n.targetZ - n.z) * 0.055 * h) * damping;
      }
      // Weak short-range pressure preserves individual lobes while allowing fusion.
      for (let i = 0; i < this.nodes.length; i++) {
        const a = this.nodes[i];
        for (let j = i + 1; j < this.nodes.length; j++) {
          const b = this.nodes[j];
          const dx = a.x - b.x,
            dy = (a.y - b.y) * 2.16,
            dz = a.z - b.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (distance > 0.00001 && distance < 0.1) {
            const force = ((0.1 - distance) * 0.035 * h) / distance;
            a.vx += dx * force;
            b.vx -= dx * force;
            a.vz += dz * force;
            b.vz -= dz * force;
            a.vy += dy * force * 0.46;
            b.vy -= dy * force * 0.46;
          }
        }
      }
      for (const n of this.nodes) {
        n.x += n.vx * h;
        n.y += n.vy * h;
        n.z += n.vz * h;
        if (n.y < 0.2) {
          n.y = 0.2;
          n.vy = Math.max(0, n.vy) * 0.2;
        }
        if (n.y > 0.79) {
          n.y = 0.79;
          n.vy = Math.min(0, n.vy) * 0.2;
        }
        const radius = 0.105 - 0.025 * Math.max(0, (n.y - 0.5) / 0.29);
        const dx = n.x - 0.5,
          dz = n.z - 0.5;
        const r = Math.sqrt(dx * dx + dz * dz);
        if (r > radius) {
          const nx = dx / r,
            nz = dz / r;
          n.x = 0.5 + nx * radius;
          n.z = 0.5 + nz * radius;
          const outward = Math.max(0, n.vx * nx + n.vz * nz);
          n.vx -= outward * nx;
          n.vz -= outward * nz;
        }
      }
    }
  }
}
