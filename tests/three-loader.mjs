// Resolve the browser import-map entries to the same vendored Three.js in Node tests.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "three")
    return {
      url: new URL("../dist/vendor/three.module.js", import.meta.url).href,
      shortCircuit: true,
    };
  if (specifier.startsWith("three/addons/"))
    return {
      url: new URL(
        "../dist/vendor/addons/" + specifier.slice("three/addons/".length),
        import.meta.url,
      ).href,
      shortCircuit: true,
    };
  return nextResolve(specifier, context);
}
