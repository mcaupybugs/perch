import React from "react";
import ReactDOM from "react-dom/client";
import Pill from "./Pill";
import ItemWindow from "./ItemWindow";
import "./styles.css";

// One bundle serves every window: pop-outs are opened with `?item=<id>`.
const itemId = new URLSearchParams(window.location.search).get("item");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{itemId ? <ItemWindow id={itemId} /> : <Pill />}</React.StrictMode>,
);
