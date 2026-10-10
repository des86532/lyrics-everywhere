import { describe, expect, it, vi } from "vitest";
import { fetchYouTubeMusicCredit, parseYouTubeMusicCredit } from "../extension-ui/src/youtube-music-credit.js";

const VIDEO_ID = "7mDDM0eBWR0";
const OTHER_VIDEO_ID = "AAAAAAAAAAA";

const card = (title: string, subtitle: string) => ({
  videoAttributeViewModel: { title, subtitle, secondarySubtitle: { content: "What a Wonderful Life" } },
});
const musicList = (...cards: unknown[]) => ({
  horizontalCardListRenderer: { footerButton: { buttonViewModel: { iconName: "MUSIC" } }, cards },
});
const pageData = (items: unknown[], videoId = VIDEO_ID) => ({
  currentVideoEndpoint: { watchEndpoint: { videoId } },
  engagementPanels: [
    { engagementPanelSectionListRenderer: { content: { structuredDescriptionContentRenderer: { items: [{ expandableVideoDescriptionBodyRenderer: {} }, ...items] } } } },
  ],
});
const pageHtml = (data: unknown) => `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;

describe("YouTube music credit", () => {
  it("returns the single credit from the MUSIC section", () => {
    const html = pageHtml(pageData([musicList(card("I’m gonna TOESA (Narr. KIAN84)", "SOYEON"))]));
    expect(parseYouTubeMusicCredit(html, VIDEO_ID)).toEqual({ title: "I’m gonna TOESA (Narr. KIAN84)", artist: "SOYEON" });
  });

  it("returns null when the section holds two different songs", () => {
    const html = pageHtml(pageData([musicList(card("Song A", "Artist"), card("Song B", "Artist"))]));
    expect(parseYouTubeMusicCredit(html, VIDEO_ID)).toBeNull();
  });

  it("collapses repeated credits of the same song", () => {
    const html = pageHtml(pageData([musicList(card("Song A", "Artist"), card("song a", "ARTIST"))]));
    expect(parseYouTubeMusicCredit(html, VIDEO_ID)).toEqual({ title: "Song A", artist: "Artist" });
  });

  it("does not merge distinct symbol-only titles into one credit", () => {
    const html = pageHtml(pageData([musicList(card("★", "SOYEON"), card("☆", "SOYEON"))]));
    expect(parseYouTubeMusicCredit(html, VIDEO_ID)).toBeNull();
  });

  it("ignores card lists whose icon is not MUSIC", () => {
    const placeList = { horizontalCardListRenderer: { footerButton: { buttonViewModel: { iconName: "PLACE" } }, cards: [card("Song A", "Artist")] } };
    expect(parseYouTubeMusicCredit(pageHtml(pageData([placeList])), VIDEO_ID)).toBeNull();
  });

  it("rejects page data that belongs to another video", () => {
    const html = pageHtml(pageData([musicList(card("Song A", "Artist"))], OTHER_VIDEO_ID));
    expect(parseYouTubeMusicCredit(html, VIDEO_ID)).toBeNull();
  });

  it("returns null when the initial data is missing or malformed", () => {
    expect(parseYouTubeMusicCredit("<html>consent page</html>", VIDEO_ID)).toBeNull();
    expect(parseYouTubeMusicCredit("<script>var ytInitialData = {not json};</script>", VIDEO_ID)).toBeNull();
  });

  it("fetches the watch page and parses the credit from its response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      pageHtml(pageData([musicList(card("Song A", "Artist"))])),
      { status: 200, headers: { "Content-Type": "text/html" } },
    ));
    await expect(fetchYouTubeMusicCredit(VIDEO_ID, fetcher)).resolves.toEqual({ title: "Song A", artist: "Artist" });
  });

  it("rejects with the HTTP status when the watch page fails", async () => {
    const fetcher: typeof fetch = async () => new Response("", { status: 503 });
    await expect(fetchYouTubeMusicCredit(VIDEO_ID, fetcher)).rejects.toThrow("YouTube 頁面讀取失敗（HTTP 503）。");
  });

  it("refuses invalid video ids without sending a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchYouTubeMusicCredit("bad", fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
