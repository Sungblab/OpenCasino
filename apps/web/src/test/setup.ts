import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest 는 globals 를 켜지 않았으므로 Testing Library 의 자동 정리가 걸리지 않는다. 직접 건다 —
// 안 그러면 앞 테스트의 포털(도움말 시트 등)이 document.body 에 남아 다음 테스트의 쿼리에 잡힌다.
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

// jsdom 에 없는 브라우저 API 중 공용 컴포넌트가 부르는 것들.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => undefined;
