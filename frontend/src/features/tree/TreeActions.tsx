import { createContext, useContext } from "react";

/** What a person on the canvas can ask of the canvas, without new props on every render. */
export type TreeActions = {
  toggleFold: (unit: string) => void;
  readOnly: boolean;
};

export const TreeActionsContext = createContext<TreeActions>({
  toggleFold: () => {},
  readOnly: true,
});

export function useTreeActions(): TreeActions {
  return useContext(TreeActionsContext);
}
