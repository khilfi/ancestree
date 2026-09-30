// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UndoRedo } from "./UndoRedo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Callbacks = { onSettled?: () => void };

const moves = vi.hoisted(() => ({
  undo: vi.fn<(step: string, callbacks: Callbacks) => void>(),
  redo: vi.fn<(step: string, callbacks: Callbacks) => void>(),
}));

vi.mock("@/api/queries", () => ({
  useHistory: () => ({
    data: {
      undo: { id: "add-hassan", label: "Add Hassan", at: "2026-01-01T00:00:00Z" },
      redo: { id: "edit-aminah", label: "Edit Aminah", at: "2026-01-01T00:00:00Z" },
    },
  }),
  useHistoryMove: (direction: "undo" | "redo") => ({ mutate: moves[direction], isPending: false }),
}));

/** The server has answered the latest undo or redo. */
function answer(move: typeof moves.undo) {
  move.mock.lastCall?.[1].onSettled?.();
}

function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("Ctrl+Z and Ctrl+Y", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    moves.undo.mockReset();
    moves.redo.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<UndoRedo />));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("undo and redo the latest change, naming the step they expect", () => {
    expect(press("z").defaultPrevented).toBe(true);
    expect(moves.undo).toHaveBeenCalledWith("add-hassan", expect.anything());
    answer(moves.undo);

    press("y");
    expect(moves.redo).toHaveBeenCalledWith("edit-aminah", expect.anything());
    answer(moves.redo);

    press("Z", { shiftKey: true });
    expect(moves.redo).toHaveBeenCalledTimes(2);
  });

  it("stay the field's own while typing", () => {
    const field = document.createElement("input");
    document.body.append(field);
    expect(press("z", {}, field).defaultPrevented).toBe(false);
    expect(moves.undo).not.toHaveBeenCalled();
  });

  it("wait while a dialog is open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    press("z");
    expect(moves.undo).not.toHaveBeenCalled();
  });

  it("wait for the one before to finish", () => {
    press("z");
    press("z");
    expect(moves.undo).toHaveBeenCalledTimes(1);
    answer(moves.undo);
    press("z");
    expect(moves.undo).toHaveBeenCalledTimes(2);
  });

  it("leave other keys alone", () => {
    press("z", { ctrlKey: false });
    press("z", { altKey: true });
    press("s");
    expect(moves.undo).not.toHaveBeenCalled();
    expect(moves.redo).not.toHaveBeenCalled();
  });
});
