# Codex instructions

Implement app-feedback: a privacy-conscious Chrome MV3 extension and Cloudflare Workers backend for small friend-group app-review events.

Read README.md and docs/implementation-plan.md first. Work in incremental, independently testable PRs. **Begin with milestone 1 only.**

- TypeScript strict across packages; Hono + D1, optional R2 only in later milestone.
- MV3: activeTab + scripting on user action. Avoid broad host permissions; isolated Shadow DOM UI. Escape exits selection.
- No OpenAI API or AI feature in MVP.
- Do not deploy, create cloud resources, publish extension, or open additional PRs without approval.
- Zod validation, parameterized SQL, server-side authorization on all read/write endpoints.
- Never persist outerHTML, form input values, cookies, auth headers, or the whole DOM.
- Bind feedback to registered page origin and normalized route. Never trust client-supplied roles.
- Screenshots are out of scope until explicit approval.
- Favor expiring opaque participant tokens, hashed at rest; don't log invite codes or tokens.
- Test lint, typecheck, unit/integration tests. Include D1 integration coverage in Workers runtime.
- Document setup and limitations. Report changed files, test results, risks, next acceptance criterion after each task.
