import "@xyflow/react/dist/style.css";
import "./index.css";

import { createRoot } from "react-dom/client";
import { Root } from "./app/Root";
import { router } from "./app/router";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(<Root router={router} />);
