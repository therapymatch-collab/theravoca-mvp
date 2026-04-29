import { GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * DraggableRankList
 *
 * Shared accessible drag-and-drop ranked list for the deep-match T1
 * question on both the therapist signup form and the in-portal edit
 * page. Replaces the older up/down arrow controls that user testing
 * showed were "difficult to use" on touch screens.
 *
 * Powered by @dnd-kit (mouse + touch + keyboard sensors). Each row has
 * a visible grip handle so therapists know it's draggable, and the
 * whole row is the drag target for forgiving touch gestures. Keyboard
 * users press Space on the handle, then ↑/↓ to move, then Space again
 * to drop — handled automatically by `KeyboardSensor`.
 *
 * `order` is an array of slugs; `items` is the option list with
 * { v, l }. The component is fully controlled — `onChange(nextOrder)`
 * is called every time the order changes.
 */
export default function DraggableRankList({ items, order, onChange, testid }) {
  const labelFor = (slug) => items.find((i) => i.v === slug)?.l || slug;

  const sensors = useSensors(
    // Require an 8px move before drag starts so taps/clicks on the row
    // don't accidentally trigger a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch needs a 120ms hold to disambiguate from scroll on mobile.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id);
    const newIndex = order.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(order, oldIndex, newIndex));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol
          className="flex flex-col gap-2"
          data-testid={testid}
          aria-label="Drag to reorder. Most instinctive at the top."
        >
          {(order || []).map((slug, idx) => (
            <SortableRow
              key={slug}
              id={slug}
              index={idx}
              label={labelFor(slug)}
              testid={testid}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, index, label, testid }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the row slightly while it's being dragged so users see clear
    // motion feedback. zIndex keeps it above the rest of the list.
    zIndex: isDragging ? 10 : "auto",
    boxShadow: isDragging
      ? "0 8px 24px rgba(45, 74, 62, 0.18)"
      : undefined,
    opacity: isDragging ? 0.95 : 1,
    cursor: isDragging ? "grabbing" : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`${testid}-row-${id}`}
      className={`flex items-center gap-2 sm:gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-2.5 sm:px-3 py-2 select-none ${
        isDragging ? "border-[#2D4A3E]" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing text-[#6D6A65] hover:text-[#2D4A3E] hover:bg-[#E8E5DF] rounded p-1 -ml-1 transition focus:outline-none focus:ring-2 focus:ring-[#2D4A3E]/40"
        data-testid={`${testid}-handle-${id}`}
        aria-label={`Drag to reorder: ${label}. Currently rank ${index + 1}.`}
      >
        <GripVertical size={16} strokeWidth={1.8} />
      </button>
      <span className="font-mono text-xs text-[#6D6A65] w-5 text-center shrink-0">
        {index + 1}
      </span>
      <span className="flex-1 text-sm text-[#2B2A29] leading-snug">
        {label}
      </span>
    </li>
  );
}
