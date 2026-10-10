# Conectar CEITBA a tu asistente de IA

> La guía con los pasos para cada asistente, y tus conexiones y claves, está en
> **[ceitba.org.ar/ia](https://ceitba.org.ar/ia)**. Abrir `https://ceitba.org.ar/mcp` en el navegador te lleva ahí.

El servidor MCP de CEITBA le da a tu asistente (Claude, ChatGPT, Cursor, VS Code, Kiro...) acceso a:

- **Sin iniciar sesión:** planes y materias, comisiones y horarios, aulas libres, el **Combinador de Horarios**,
  noticias, eventos, organizaciones, beneficios y el equipo del CEITBA.
- **Con tu cuenta @itba.edu.ar:** tus horarios guardados, grupos de estudio, propuestas, organizaciones que seguís y,
  si tenés Apuntes habilitado, los apuntes y la wiki de cada materia, con búsqueda por significado para responder
  dudas citando las páginas.
- **Personal de CEITBA:** también la cola de correcciones de horario y de propuestas, usuarios y el resumen semanal.

Para estudiantes la conexión es de **lectura**: el asistente no puede publicar, votar ni modificar nada en tu nombre.
Lo único que puede hacer es **reportar** una página de wiki o un archivo de apuntes con errores, cuando se lo pedís.

**Dirección del servidor:** `https://ceitba.org.ar/mcp`

La primera vez, tu cliente abre el navegador. CEITBA te muestra qué asistente pide acceso y a dónde te va a devolver:
si lo reconocés, tocá **Continuar con Google** e iniciá sesión con tu cuenta **@itba.edu.ar**. Si no empezaste vos la
conexión (por ejemplo, alguien te mandó el link), tocá **Cancelar**.

## Claude (claude.ai y Claude Desktop)

1. Andá a **Configuración → Conectores → Agregar conector personalizado**.
2. Nombre: `CEITBA`. URL: `https://ceitba.org.ar/mcp`.
3. Tocá **Conectar** e iniciá sesión con Google.

En una conversación, activá el conector CEITBA desde el menú de herramientas.

## ChatGPT

Los conectores MCP personalizados dependen de tu plan y de que tengas habilitado el modo desarrollador.

1. **Configuración → Conectores → Crear** (o **Agregar servidor MCP**).
2. URL: `https://ceitba.org.ar/mcp`. Autenticación: **OAuth**.
3. Iniciá sesión con Google.

## Claude Code

```sh
claude mcp add --transport http ceitba https://ceitba.org.ar/mcp
```

Después, dentro de Claude Code, corré `/mcp` y elegí `ceitba` para iniciar sesión.

## Cursor

En `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ceitba": { "url": "https://ceitba.org.ar/mcp" }
  }
}
```

## VS Code (GitHub Copilot)

En `.vscode/mcp.json` o desde **MCP: Add Server**:

```json
{
  "servers": {
    "ceitba": { "type": "http", "url": "https://ceitba.org.ar/mcp" }
  }
}
```

## Kiro

En `~/.kiro/settings/mcp.json` (para todos tus proyectos) o en `.kiro/settings/mcp.json` (solo un proyecto):

```json
{
  "mcpServers": {
    "ceitba": { "url": "https://ceitba.org.ar/mcp" }
  }
}
```

## Clientes sin OAuth: usar una clave de API

Si tu cliente no soporta el inicio de sesión OAuth, podés usar una **clave de API** de lectura y reportes.

1. Entrá a [ceitba.org.ar/ia](https://ceitba.org.ar/ia) con tu cuenta y tocá **Crear clave**.
2. Guardá la clave `ceitba_...`: se muestra **una sola vez**. Tratala como una contraseña.
3. Configurá el servidor con el header `Authorization: Bearer ceitba_...`. Por ejemplo, en Cursor:

   ```json
   { "mcpServers": { "ceitba": { "url": "https://ceitba.org.ar/mcp",
     "headers": { "Authorization": "Bearer ceitba_..." } } } }
   ```

En [ceitba.org.ar/ia](https://ceitba.org.ar/ia) ves tus claves y los asistentes conectados (`MCP · <cliente>`), y
podés revocarlos.

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
- "¿Cómo se calcula el VAN según la wiki de Matemática Financiera?" (requiere Apuntes)
- "La fórmula de esta página está mal, reportala." (requiere Apuntes)

## Privacidad

- El servidor guarda, cifrada, una clave de API con los permisos mínimos de tu sesión, nunca tu contraseña de Google.
- Los registros incluyen tu id de usuario, la herramienta usada y si funcionó. No incluyen tus preguntas ni tu email.
- Para desconectarte, quitá el conector en tu cliente o revocá la conexión en [ceitba.org.ar/ia](https://ceitba.org.ar/ia).

---

## English

The CEITBA MCP server gives AI assistants access to ITBA's study plans, commissions and timetables, free classrooms,
the schedule combiner, news, events, organizations and benefits. If you sign in with your @itba.edu.ar account, it
also reaches your saved schedules, study groups, proposals and, with Apuntes enabled, subject notes and wikis.
Student connections can read and, when you ask, **report** a wiki page or Apuntes file with mistakes; nothing
else. Step-by-step instructions, your connections and your keys are at [ceitba.org.ar/ia](https://ceitba.org.ar/ia).

- **Server URL:** `https://ceitba.org.ar/mcp`. Add it as a remote / custom connector (HTTP, OAuth) in your client.
  CEITBA shows which assistant is asking and where it will send you back; if you started the connection, continue
  and sign in with Google, otherwise cancel.
- **Claude Code:** `claude mcp add --transport http ceitba https://ceitba.org.ar/mcp`
- **Cursor / Kiro:** `{"mcpServers":{"ceitba":{"url":"https://ceitba.org.ar/mcp"}}}`
- **VS Code:** `{"servers":{"ceitba":{"type":"http","url":"https://ceitba.org.ar/mcp"}}}`
- **No OAuth support?** Create an API key at [ceitba.org.ar/ia](https://ceitba.org.ar/ia) and send it as
  `Authorization: Bearer ceitba_...`.
- **Local stdio:** `bun apps/mcp/src/stdio.ts` with `CEITBA_API_KEY` set.

Replies follow your language. Spanish is the default; your CEITBA profile language switches the server's own messages
to English.
