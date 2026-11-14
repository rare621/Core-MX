function compactMesh(mesh) {
  const vertices = new Map(), positions = [], normals = [], uvs = [], indices = [], groups = [];
  for (const group of mesh.groups) {
    const start = indices.length;
    for (let i = group.start; i < group.start + group.count; i++) {
      const old = mesh.indices[i];
      if (!vertices.has(old)) {
        vertices.set(old, vertices.size);
        positions.push(...mesh.positions.slice(old * 3, old * 3 + 3));
        normals.push(...mesh.normals.slice(old * 3, old * 3 + 3));
        uvs.push(...mesh.uvs.slice(old * 2, old * 2 + 2));
      }
      indices.push(vertices.get(old));
    }
    if (indices.length > start) groups.push({ ...group, start, count: indices.length - start });
  }
  return { ...mesh, positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices), groups };
}
module.exports = { compactMesh };
