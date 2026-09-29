// Загрузчик 3D-сцены: сперва пробуем настоящий three.js (scene3d.js), и только если WebGL
// недоступен или CDN не отдал файл — тихо откатываемся на лёгкую CSS-версию (scene-css.js).
// app.js работает с результатом одинаково в обоих случаях (метод .set(key, filled)).
export async function createScene(root) {
  try {
    if (!window.WebGLRenderingContext) throw new Error("WebGL не поддерживается");
    const { Scene3D } = await import("./scene3d.js");
    return await Scene3D.create(root);
  } catch (e) {
    console.warn("3D-сцена недоступна, показываю упрощённую версию:", e);
    const { SceneCss } = await import("./scene-css.js");
    return new SceneCss(root);
  }
}
