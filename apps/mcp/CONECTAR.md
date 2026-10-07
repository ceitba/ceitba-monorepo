# Conectar CEITBA a tu asistente de IA

El servidor MCP de CEITBA le da a tu asistente (Claude, ChatGPT, Cursor, VS Code, Kiro...) acceso a:

- **Sin iniciar sesión:** planes y materias, comisiones y horarios, aulas libres, el **Combinador de Horarios**,
  noticias, eventos, organizaciones, beneficios y el equipo del CEITBA.
- **Con tu cuenta @itba.edu.ar:** tus horarios guardados, grupos de estudio, propuestas, organizaciones que seguís y,
  si tenés Apuntes habilitado, los apuntes y la wiki de cada materia.
- **Personal de CEITBA:** también la cola de correcciones de horario y de propuestas, usuarios y el resumen semanal.

Para estudiantes la conexión es de **solo lectura**: el asistente no puede publicar, votar ni modificar nada en tu
nombre.

**Dirección del servidor:** `https://mcp.ceitba.org.ar/mcp`

La primera vez, tu cliente abre el navegador para que inicies sesión con Google. Usá tu cuenta **@itba.edu.ar**.

## Claude (claude.ai y Claude Desktop)

1. Andá a **Configuración → Conectores → Agregar conector personalizado**.
2. Nombre: `CEITBA`. URL: `https://mcp.ceitba.org.ar/mcp`.
3. Tocá **Conectar** e iniciá sesión con Google.

En una conversación, activá el conector CEITBA desde el menú de herramientas.

## ChatGPT

Los conectores MCP personalizados dependen de tu plan y de que tengas habilitado el modo desarrollador.

1. **Configuración → Conectores → Crear** (o **Agregar servidor MCP**).
2. URL: `https://mcp.ceitba.org.ar/mcp`. Autenticación: **OAuth**.
3. Iniciá sesión con Google.

## Claude Code

```sh
claude mcp add --transport http ceitba https://mcp.ceitba.org.ar/mcp
```

Después, dentro de Claude Code, corré `/mcp` y elegí `ceitba` para iniciar sesión.

## Cursor

En `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ceitba": { "url": "https://mcp.ceitba.org.ar/mcp" }
  }
}
```

## VS Code (GitHub Copilot)

En `.vscode/mcp.json` o desde **MCP: Add Server**:

```json
{
  "servers": {
    "ceitba": { "type": "http", "url": "https://mcp.ceitba.org.ar/mcp" }
  }
}
```

## Kiro

En `~/.kiro/settings/mcp.json` (para todos tus proyectos) o en `.kiro/settings/mcp.json` (solo un proyecto):

```json
{
  "mcpServers": {
    "ceitba": { "url": "https://mcp.ceitba.org.ar/mcp" }
  }
}
```

## Clientes sin OAuth: usar una clave de API

Si tu cliente no soporta el inicio de sesión OAuth, podés usar una **clave de API de solo lectura**.

1. Entrá a [ceitba.org.ar](https://ceitba.org.ar) con tu cuenta.
2. Abrí la consola del navegador (F12 → Consola) y pegá:

   ```js
   fetch('/api/v1/auth/api-keys', {
     method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ name: 'MCP', ttlDays: 90, scopes: ['read'] })
   }).then(r => r.json()).then(k => console.log(k.key))
   ```

3. Guardá la clave `ceitba_...`: se muestra **una sola vez**. Tratala como una contraseña.
4. Configurá el servidor con el header `Authorization: Bearer ceitba_...`. Por ejemplo, en Cursor:

   ```json
   { "mcpServers": { "ceitba": { "url": "https://mcp.ceitba.org.ar/mcp",
     "headers": { "Authorization": "Bearer ceitba_..." } } } }
   ```

Para revocar una clave: `GET /api/v1/auth/api-keys` lista tus claves y `DELETE /api/v1/auth/api-keys/<id>` borra una.
Las sesiones OAuth del servidor MCP aparecen ahí como `MCP · <cliente>`.

## Modo local (stdio), para desarrolladores

Necesitás [Bun](https://bun.sh) y este repositorio:

```sh
git clone https://github.com/ceitba/ceitba-monorepo && cd ceitba-monorepo && bun install
```

Por ejemplo, en Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ceitba": {
      "command": "bun",
      "args": ["/ruta/a/ceitba-monorepo/apps/mcp/src/stdio.ts"],
      "env": { "CEITBA_API_KEY": "ceitba_..." }
    }
  }
}
```

Sin `CEITBA_API_KEY` solo aparecen las herramientas públicas.

## Ejemplos para probar

- "¿Qué aulas hay libres ahora en SDF?"
- "Armame un horario con 93.41, 72.11 y 81.02 del plan S10-Rev23 sin clases los viernes."
- "¿Qué eventos hay esta semana?"
- "Explicame los temas de la wiki de Física I." (requiere Apuntes)

## Privacidad

- El servidor guarda, cifrada, una clave de API con los permisos mínimos de tu sesión, nunca tu contraseña de Google.
- Los registros incluyen tu id de usuario, la herramienta usada y si funcionó. No incluyen tus preguntas ni tu email.
- Para desconectarte, quitá el conector en tu cliente o revocá la clave como se explica arriba.

---

## English

The CEITBA MCP server gives AI assistants access to ITBA's study plans, commissions and timetables, free classrooms,
the schedule combiner, news, events, organizations and benefits. If you sign in with your @itba.edu.ar account, it
also reaches your saved schedules, study groups, proposals and, with Apuntes enabled, subject notes and wikis.
Student connections are **read-only**.

- **Server URL:** `https://mcp.ceitba.org.ar/mcp`. Add it as a remote / custom connector (HTTP, OAuth) in your client
  and sign in with Google.
- **Claude Code:** `claude mcp add --transport http ceitba https://mcp.ceitba.org.ar/mcp`
- **Cursor / Kiro:** `{"mcpServers":{"ceitba":{"url":"https://mcp.ceitba.org.ar/mcp"}}}`
- **VS Code:** `{"servers":{"ceitba":{"type":"http","url":"https://mcp.ceitba.org.ar/mcp"}}}`
- **No OAuth support?** Create a read-only API key (see the browser-console snippet above) and send it as
  `Authorization: Bearer ceitba_...`.
- **Local stdio:** `bun apps/mcp/src/stdio.ts` with `CEITBA_API_KEY` set.

Replies follow your language. Spanish is the default; your CEITBA profile language switches the server's own messages
to English.
