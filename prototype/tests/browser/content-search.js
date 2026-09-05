async (page) => {
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const checks = [];
  for (const width of [1280, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole("heading", { name: "正文索引", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/phase-c-settings-${width}.png` });
    const layout = await page.getByRole("dialog").evaluate((el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    if (layout.scrollWidth > layout.width) throw Error("正文设置横向溢出");
    checks.push({ width, ...layout });
  }
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SearchHitSummary } = await import("/src/features/library/LibraryPanelParts.jsx");
    const cases = await fetch("/shared/content-snippet-cases.json").then((response) => response.json());
    const cell = document.querySelector("tbody th");
    const host = document.createElement("div");
    host.dataset.contentQa = "true";
    cell.append(host);
    const item = cases.find((entry) => entry.name === "middle");
    ReactDOM.createRoot(host).render(React.createElement(SearchHitSummary, { entry: { id: "file-a" }, searchMode: "content", searchQuery: item.query, searchResult: item }));
  });
  await page.locator("[data-content-qa] mark").waitFor();
  if (await page.locator("[data-content-qa] mark").textContent() !== "研究😀") throw Error("真实摘要高亮错位");
  for (const width of [1280, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: `output/playwright/phase-c-summary-${width}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw Error("页面横向溢出");
  }
  console.log({ settings: checks, highlight: "研究😀", viewports: [1280, 720] });
}
