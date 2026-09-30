/** Whether a key press goes into a text field or the story editor: then it's theirs. */
export function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName))
  );
}
