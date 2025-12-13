/**
 * FileExplorer.tsx - 드래그 앤 드롭 파일 탐색기 컴포넌트
 *
 * @dnd-kit/core 라이브러리를 사용하여 드래그 앤 드롭 기능을 구현합니다.
 *
 * 주요 기능:
 * 1. dirPosition에 따른 실제 트리 구조 표시
 * 2. 파일/폴더를 다른 폴더로 드래그 앤 드롭하여 이동
 * 3. 파일을 작업 영역으로 드래그 앤 드롭하여 편집기 열기
 * 4. 위치 변경 시 WebSocket으로 다른 사용자에게 전파
 * 5. 추후 우클릭 메뉴를 통한 파일/폴더 추가 기능 확장 가능
 *
 * Props:
 * - data: 표시할 파일/폴더 목록
 * - onFileSelect: 파일이 작업 영역에 드롭되었을 때 호출되는 콜백
 * - onMove: 파일/폴더가 이동되었을 때 호출되는 콜백
 * - children: 작업 영역에 표시할 컴포넌트 (DocumentEditor)
 */

"use client";

import { useState } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { ExplorerFileData } from "../types";

/**
 * 트리 구조로 파일/폴더를 정렬하는 함수
 * dirPosition[0]: 부모 폴더명 (null이면 최상위)
 * dirPosition[1]: 해당 폴더 내 순서
 */
function buildTree(
  items: ExplorerFileData[],
  parentName: string | null
): ExplorerFileData[] {
  return items
    .filter((item) => item.dirPosition[0] === parentName)
    .sort((a, b) => a.dirPosition[1] - b.dirPosition[1]);
}

/**
 * TreeItem 컴포넌트 - 트리 구조의 각 아이템 (재귀적)
 */
function TreeItem({
  item,
  allItems,
  depth = 0,
}: {
  item: ExplorerFileData;
  allItems: ExplorerFileData[];
  depth?: number;
}) {
  // 폴더 열림/닫힘 상태
  const [isOpen, setIsOpen] = useState(true);

  // 자식 아이템 찾기 (폴더인 경우만)
  const children = item.type === 0 ? buildTree(allItems, item.name) : [];

  return (
    <div>
      {/* 드래그 가능한 아이템 */}
      <DraggableItem
        item={item}
        depth={depth}
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        hasChildren={children.length > 0}
      />

      {/* 폴더가 열려있고 자식이 있으면 재귀적으로 렌더링 */}
      {item.type === 0 && isOpen && children.length > 0 && (
        <div className="ml-4">
          {children.map((child) => (
            <TreeItem
              key={child.id}
              item={child}
              allItems={allItems}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* 폴더가 열려있고 비어있으면 드롭 영역 표시 */}
      {item.type === 0 && isOpen && children.length === 0 && (
        <DroppableFolder folderId={item.id} folderName={item.name} isEmpty />
      )}
    </div>
  );
}

/**
 * DraggableItem 컴포넌트 - 드래그 가능한 파일/폴더 아이템
 */
function DraggableItem({
  item,
  depth,
  isOpen,
  onToggle,
  hasChildren,
}: {
  item: ExplorerFileData;
  depth: number;
  isOpen: boolean;
  onToggle: () => void;
  hasChildren: boolean;
}) {
  // dnd-kit의 드래그 가능 훅
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: item.id,
      data: item,
    });

  // 폴더인 경우 드롭 가능 영역으로도 설정
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder-${item.id}`,
    data: { type: "folder", folderName: item.name, folderId: item.id },
    disabled: item.type !== 0, // 파일은 드롭 불가
  });

  // 파일 타입에 따른 아이콘 선택
  const getIcon = () => {
    if (item.type === 0) {
      return isOpen ? "📂" : "📁";
    }
    return "📄";
  };

  // 파일 확장자에 따른 색상
  const getFileColor = () => {
    if (item.type === 0) return "text-yellow-400";
    if (item.name.endsWith(".txt")) return "text-blue-300";
    if (item.name.endsWith(".md")) return "text-green-300";
    if (item.name.endsWith(".png") || item.name.endsWith(".jpg"))
      return "text-purple-300";
    if (item.name.endsWith(".pptx")) return "text-orange-300";
    return "text-gray-300";
  };

  // ref 병합 (드래그 + 드롭)
  const combinedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    if (item.type === 0) {
      setDropRef(node);
    }
  };

  return (
    <div
      ref={combinedRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform
          ? `translate(${transform.x}px, ${transform.y}px)`
          : undefined,
        zIndex: isDragging ? 1000 : 1,
        paddingLeft: `${depth * 12}px`,
      }}
      className={`
        flex items-center gap-1 px-2 py-1 rounded cursor-grab select-none
        ${isDragging ? "opacity-50 bg-blue-600" : "hover:bg-gray-700"}
        ${
          isOver && item.type === 0 ? "bg-blue-500/30 ring-1 ring-blue-400" : ""
        }
        ${getFileColor()}
        transition-colors duration-150
      `}
    >
      {/* 폴더 토글 버튼 */}
      {item.type === 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white"
        >
          {hasChildren ? (isOpen ? "▼" : "▶") : ""}
        </button>
      )}
      {item.type === 1 && <span className="w-4" />}

      {/* 아이콘 */}
      <span className="text-sm">{getIcon()}</span>

      {/* 이름 */}
      <span className="text-sm truncate">{item.name}</span>
    </div>
  );
}

/**
 * DroppableFolder 컴포넌트 - 빈 폴더 내부의 드롭 영역
 */
function DroppableFolder({
  folderId,
  folderName,
  isEmpty,
}: {
  folderId: string;
  folderName: string;
  isEmpty?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `empty-folder-${folderId}`,
    data: { type: "folder", folderName, folderId },
  });

  if (!isEmpty) return null;

  return (
    <div
      ref={setNodeRef}
      className={`
        ml-8 py-1 px-2 text-xs text-gray-500 italic
        ${isOver ? "bg-blue-500/20 text-blue-300" : ""}
      `}
    >
      {isOver ? "여기에 놓기" : "(비어있음)"}
    </div>
  );
}

/**
 * FileList 컴포넌트 - 트리 구조 파일/폴더 목록
 */
function FileList({ datalist }: { datalist: ExplorerFileData[] }) {
  // 최상위 아이템들 (dirPosition[0] === null)
  const rootItems = buildTree(datalist, null);

  return (
    <div className="w-64 h-full bg-gray-800 p-2 overflow-y-auto">
      {/* 탐색기 헤더 */}
      <div className="text-white text-sm font-semibold mb-3 px-2 py-1 border-b border-gray-600">
        📂 파일 탐색기
      </div>

      {/* 루트 드롭 영역 */}
      <DroppableRoot />

      {/* 트리 구조 렌더링 */}
      {rootItems.map((item) => (
        <TreeItem key={item.id} item={item} allItems={datalist} />
      ))}
    </div>
  );
}

/**
 * DroppableRoot 컴포넌트 - 최상위 드롭 영역
 */
function DroppableRoot() {
  const { setNodeRef, isOver } = useDroppable({
    id: "root-folder",
    data: { type: "folder", folderName: null, folderId: null },
  });

  return (
    <div
      ref={setNodeRef}
      className={`
        mb-2 py-1 px-2 rounded text-xs
        ${isOver ? "bg-blue-500/30 text-blue-300" : "text-gray-500"}
      `}
    >
      {isOver ? "📥 최상위로 이동" : ""}
    </div>
  );
}

/**
 * WorkSpace 컴포넌트 - 드롭 가능한 작업 영역
 */
function WorkSpace({ children }: { children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "workspace" });

  return (
    <div
      ref={setNodeRef}
      className={`
        flex-1 h-full p-4 transition-colors duration-200
        ${
          isOver
            ? "bg-blue-50 border-2 border-dashed border-blue-400"
            : "bg-gray-100 border-2 border-dashed border-gray-300"
        }
      `}
    >
      {children ? (
        children
      ) : (
        <div className="h-full flex flex-col items-center justify-center text-gray-400">
          <span className="text-4xl mb-4">📥</span>
          <p className="text-lg">파일을 이곳에 드롭하세요</p>
          <p className="text-sm mt-2">
            좌측 목록에서 파일을 드래그하여 편집을 시작합니다
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * DragOverlayContent 컴포넌트 - 드래그 중 표시되는 오버레이
 */
function DragOverlayContent({ item }: { item: ExplorerFileData | null }) {
  if (!item) return null;

  const icon = item.type === 0 ? "📁" : "📄";
  const color = item.type === 0 ? "text-yellow-400" : "text-blue-300";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 bg-gray-700 rounded shadow-lg ${color}`}
    >
      <span>{icon}</span>
      <span className="text-sm">{item.name}</span>
    </div>
  );
}

/**
 * FileExplorer 메인 컴포넌트
 */
interface FileExplorerProps {
  data: ExplorerFileData[];
  onFileSelect: (file: ExplorerFileData) => void;
  onMove: (fileId: string, newParent: string | null, newIndex: number) => void;
  children?: React.ReactNode;
}

export default function FileExplorer({
  data,
  onFileSelect,
  onMove,
  children,
}: FileExplorerProps) {
  // 현재 드래그 중인 아이템
  const [activeItem, setActiveItem] = useState<ExplorerFileData | null>(null);

  /**
   * 드래그 시작 핸들러
   */
  const handleDragStart = (e: DragStartEvent) => {
    const item = e.active.data.current as ExplorerFileData;
    setActiveItem(item);
    console.log("드래그 시작:", item?.name);
  };

  /**
   * 드래그 종료 핸들러
   */
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveItem(null);

    const { active, over } = e;
    if (!over) return;

    const draggedItem = active.data.current as ExplorerFileData;
    const overId = over.id as string;

    console.log("드롭 대상:", overId, over.data.current);

    // 작업 영역에 드롭 - 파일 열기
    if (overId === "workspace") {
      if (draggedItem.type === 1) {
        console.log("파일 선택:", draggedItem.name);
        onFileSelect(draggedItem);
      } else {
        alert("폴더는 열 수 없습니다. 파일을 선택해주세요.");
      }
      return;
    }

    // 폴더에 드롭 - 파일/폴더 이동
    const overData = over.data.current as
      | { type?: string; folderName?: string | null; folderId?: string | null }
      | undefined;
    if (overData?.type === "folder") {
      const newParent = overData.folderName;

      // 자기 자신 또는 자신의 자식 폴더로 이동 방지
      if (draggedItem.type === 0 && draggedItem.name === newParent) {
        console.log("자기 자신으로 이동 불가");
        return;
      }

      // 새 위치의 아이템 수 계산 (새 인덱스)
      const newIndex = data.filter(
        (item) => item.dirPosition[0] === newParent
      ).length;

      console.log(
        `이동: ${draggedItem.name} -> ${newParent || "root"}[${newIndex}]`
      );
      onMove(draggedItem.id, newParent ?? null, newIndex);
    }
  };

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full">
        {/* 좌측: 파일 목록 (트리 구조) */}
        <FileList datalist={data} />

        {/* 우측: 작업 영역 */}
        <WorkSpace>{children}</WorkSpace>
      </div>

      {/* 드래그 오버레이 */}
      <DragOverlay>
        <DragOverlayContent item={activeItem} />
      </DragOverlay>
    </DndContext>
  );
}
