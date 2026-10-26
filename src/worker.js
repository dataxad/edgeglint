// The standalone Worker. To add edgeglint to a Worker that you have, import `handle` from src/collect.js.
import { handle } from "./collect.js";

export default { fetch: (request, env, ctx) => handle(request, env, ctx) };
