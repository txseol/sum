/**
 * page.tsx - 메인 페이지
 *
 * 드래그 앤 드롭 파일 탐색기와 실시간 협업 문서 편집기를 통합한 메인 페이지입니다.
 *
 * 기능 흐름:
 * 1. 좌측 파일 탐색기에서 dirPosition에 따른 트리 구조 표시
 * 2. 파일/폴더를 다른 폴더로 드래그 앤 드롭하여 이동
 * 3. 파일을 작업 영역으로 드래그 앤 드롭하여 편집기 열기
 * 4. WebSocket(포트 3001)을 통해 파일 목록 및 문서 내용 실시간 동기화
 *
 * Hydration 에러 해결:
 * - FileExplorer를 dynamic import로 SSR 비활성화
 * - @dnd-kit이 서버/클라이언트에서 다른 ID를 생성하는 문제 해결
 *
 * 추후 확장 계획:
 * - 우클릭 컨텍스트 메뉴로 파일/폴더 추가
 * - 여러 문서 탭으로 관리
 * - 문서 저장 기능
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { ExplorerFileData, ActiveDocument, WebSocketMessage } from "./types";

// WebSocket 서버 포트 (고정값: 3001)
const WS_PORT = 3001;

/**
 * FileExplorer를 dynamic import로 로드 (SSR 비활성화)
 * @dnd-kit의 aria-describedby ID가 서버/클라이언트에서 달라지는 hydration 에러 방지
 */
const FileExplorer = dynamic(() => import("./components/FileExplorer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full">
      <div className="w-64 h-full bg-gray-800 p-2 animate-pulse">
        <div className="text-white text-sm font-semibold mb-3 px-2 py-1 border-b border-gray-600">
          📂 파일 탐색기
        </div>
        <div className="text-gray-500 text-sm px-2">로딩 중...</div>
      </div>
      <div className="flex-1 h-full bg-gray-100 border-2 border-dashed border-gray-300" />
    </div>
  ),
});

/**
 * DocumentEditor를 dynamic import로 로드 (SSR 비활성화)
 */
const DocumentEditor = dynamic(() => import("./components/DocumentEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-lg overflow-hidden animate-pulse">
      <div className="px-4 py-2 bg-gray-100 border-b">로딩 중...</div>
    </div>
  ),
});

export default function Home() {
  /**
   * 파일/폴더 목록 상태 (서버에서 동기화)
   */
  const [fileList, setFileList] = useState<ExplorerFileData[]>([]);

  /**
   * 현재 열려있는 문서 상태
   */
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(
    null
  );

  /**
   * WebSocket 연결 상태
   */
  const [isConnected, setIsConnected] = useState(false);

  /**
   * WebSocket 연결 참조
   */
  const ws = useRef<WebSocket | null>(null);

  /**
   * 클라이언트 고유 ID
   */
  const clientId = useRef<string>(Math.random().toString(36).substr(2, 9));

  /**
   * WebSocket 연결 및 파일 목록 동기화
   */
  useEffect(() => {
    // WebSocket 서버에 연결
    ws.current = new WebSocket(`ws://localhost:${WS_PORT}`);

    ws.current.onopen = () => {
      console.log("✅ WebSocket 연결됨");
      setIsConnected(true);

      // 서버에 파일 목록 요청
      const requestMessage: WebSocketMessage = {
        type: "requestFileList",
        clientId: clientId.current,
      };
      ws.current?.send(JSON.stringify(requestMessage));
    };

    ws.current.onmessage = (e) => {
      const data: WebSocketMessage = JSON.parse(e.data);

      // 파일 목록 수신 시 상태 업데이트
      if (data.type === "fileList" && data.fileList) {
        console.log("📂 파일 목록 수신:", data.fileList.length, "개");
        setFileList(data.fileList);
      }
    };

    ws.current.onclose = () => {
      console.log("❎ WebSocket 연결 해제");
      setIsConnected(false);
    };

    ws.current.onerror = (e) => {
      console.error("❌ WebSocket 에러:", e);
    };

    // 컴포넌트 언마운트 시 연결 해제
    return () => {
      ws.current?.close();
    };
  }, []);

  /**
   * 파일 선택 핸들러
   * 드래그 앤 드롭으로 파일이 작업 영역에 드롭되면 호출
   */
  const handleFileSelect = useCallback((file: ExplorerFileData) => {
    console.log("파일 열기:", file.name);

    // 문서 에디터 열기 (초기 내용은 DocumentEditor에서 서버에 요청)
    setActiveDocument({
      id: file.id,
      name: file.name,
      content: "", // 초기 내용은 에디터에서 로드
    });
  }, []);

  /**
   * 파일/폴더 이동 핸들러
   * 드래그 앤 드롭으로 위치가 변경되면 서버에 전송
   */
  const handleMove = useCallback(
    (fileId: string, newParent: string | null, newIndex: number) => {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        console.error("WebSocket 연결이 없습니다.");
        return;
      }

      console.log(
        `📦 이동 요청: ${fileId} -> ${newParent || "root"}[${newIndex}]`
      );

      // 서버에 이동 요청 전송
      const moveMessage: WebSocketMessage = {
        type: "move",
        clientId: clientId.current,
        fileId,
        newParent,
        newIndex,
      };
      ws.current.send(JSON.stringify(moveMessage));
    },
    []
  );

  /**
   * 문서 닫기 핸들러
   */
  const handleDocumentClose = useCallback(() => {
    console.log("문서 닫기");
    setActiveDocument(null);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden">
      {/* 연결 상태 표시 */}
      <div className="absolute top-2 right-2 z-50 flex items-center gap-2 px-3 py-1 bg-gray-800 rounded-full text-xs">
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
          }`}
        />
        <span className="text-gray-300">
          {isConnected ? "연결됨" : "연결 중..."}
        </span>
      </div>

      {/* 파일 탐색기 + 작업 영역 */}
      <FileExplorer
        data={fileList}
        onFileSelect={handleFileSelect}
        onMove={handleMove}
      >
        {/* 문서가 열려있으면 에디터 표시 */}
        {activeDocument && (
          <DocumentEditor
            document={activeDocument}
            onClose={handleDocumentClose}
          />
        )}
      </FileExplorer>
    </div>
  );
}
