// Resolve the browser import-map entry to the same vendored Three.js in Node tests.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "three")
    return {
      url: new URL("../dist/vendor/three.module.js", import.meta.url).href,
      shortCircuit: true,
    };
  return nextResolve(specifier, context);
}
