import type { IncomingMessage, ServerResponse } from "node:http";
import { createServerApp } from "../src/server/bootstrap.js";

const app = createServerApp();

export default function handler(request: IncomingMessage, response: ServerResponse) {
	const url = new URL(request.url ?? "/", "https://swipefi-fun.vercel.app");
	const path = url.searchParams.get("path") ?? "";
	url.searchParams.delete("path");
	request.url = `/api/${path}${url.search}`;
	app(request, response);
}
