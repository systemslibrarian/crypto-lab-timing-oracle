import "../styles/main.css";
import { initUi } from "./ui";

const redirectPath = new URLSearchParams(window.location.search).get("p");
if (redirectPath) {
	const clean = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`;
	window.history.replaceState(null, "", clean);
}

initUi();
