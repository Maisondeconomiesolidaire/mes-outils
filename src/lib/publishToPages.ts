export type PagePublishResult = { pageId: string; name: string } & (
  { status: "success" } | { status: "error"; error: string }
);

/** Each Page is independent: a refusal must not interrupt the other sends. */
export async function publishToPages(
  pages: { pageId: string; name: string }[],
  publish: (pageId: string) => Promise<unknown>,
  onResult: (result: PagePublishResult) => void,
) {
  const results: PagePublishResult[] = [];
  for (const page of pages) {
    let result: PagePublishResult;
    try {
      await publish(page.pageId);
      result = { ...page, status: "success" };
    } catch (error) {
      result = { ...page, status: "error", error: error instanceof Error ? error.message : "Publication impossible." };
    }
    results.push(result);
    onResult(result);
  }
  return results;
}
