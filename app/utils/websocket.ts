/**
 * WebSocket 유틸리티 함수
 *
 * HTTPS 환경에서는 wss://, HTTP 환경에서는 ws://를 사용합니다.
 * nginx 프록시를 통해 WebSocket 연결을 처리합니다.
 */

// WebSocket 서버 포트 (고정값: 3001)
export const WS_PORT = 3001;

/**
 * 현재 환경에 맞는 WebSocket URL 생성
 * - HTTPS 환경: wss://현재호스트:포트
 * - HTTP 환경 (localhost): ws://localhost:포트
 *
 * @param port WebSocket 서버 포트 (기본값: 3001)
 * @returns WebSocket URL 문자열
 */
export function getWebSocketUrl(port: number = WS_PORT): string {
  // 서버 사이드에서는 기본값 반환 (클라이언트에서만 window 접근 가능)
  if (typeof window === "undefined") {
    return `ws://localhost:${port}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname;

  // localhost인 경우 직접 포트로 연결
  if (host === "localhost" || host === "127.0.0.1") {
    return `${protocol}//${host}:${port}`;
  }

  // 외부 호스트인 경우 nginx 프록시 경로 사용 (/ws)
  // nginx에서 /ws 경로를 WebSocket 서버로 프록시하도록 설정 필요
  return `${protocol}//${host}/ws`;
}
