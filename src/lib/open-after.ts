/**
 * Open a URL that is only known after an await (a signed PDF link). Mobile
 * Safari blocks `window.open` once an await has passed, so the tab opens
 * first, synchronously, and gets its address when the URL arrives. If the
 * popup was blocked anyway, the current tab navigates instead.
 */
export async function openAfter(getUrl: () => Promise<string>) {
  const tab = typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const url = await getUrl();
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (caught) {
    tab?.close();
    throw caught;
  }
}
