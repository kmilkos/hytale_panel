# Hytale Server Manager — Research

## 1. Game Status (as of May 2026)

- Hytale entered **Early Access on January 13, 2026** on Windows PC only.
- Originally cancelled by Riot Games in June 2025; re-acquired and revived by original founders Simon Collins-Laflamme and Philippe Touchette in November 2025.
- Now fully independent. Founders committed personal funding for 10+ years.
- Returned to the **legacy Java/C# engine** (the newer C++ rewrite was scrapped).
- Active update cadence: weekly pre-release patches, stable updates every 2–6 weeks. Update 5 is currently in pre-release.
- Early access received positive reviews (PC Gamer, Eurogamer, IGN).
- Pricing: Standard $19.99 / Supporter $34.99 / Cursebreaker Founders Pack $69.99.
- Mac and Linux support planned but no confirmed dates.
- Not on Steam at launch by choice; sold via official Hytale website/launcher.

## 2. Technical Architecture

### Engine split
- **Client**: written in C#. Handles graphics, input, audio. Closed source. No game logic lives here.
- **Server**: written in **Java 25** (Adoptium distribution recommended). All game simulation runs server-side — including singleplayer (the client connects to a local server process).
- Model: "Shared Source" — server JAR is not obfuscated and can be freely decompiled. Hypixel Studios committed to releasing full server source code.

### Server process
- Launched as a standard Java process: `java [JVM args] -jar hytale-server.jar`
- Reads config from files in the server directory (formats are TOML/JSON, still stabilising in EA).
- Writes logs to stdout/stderr.
- Mods are placed in a `mods/` subfolder of the server directory.
- Server pings the official discovery service every 2 minutes using a discovery token.

### Mod file locations
- Windows: `%appdata%\Hytale\install\release\package\game\latest\mods`
- Linux: `$XDG_DATA_HOME/Hytale/install/release/package\game\latest\mods`
- macOS: `~/Application Support/Hytale/install/release/package/game/latest/mods`
- These paths may change between EA updates — treat as user-configurable with smart defaults.

## 3. Modding System

### Philosophy
Hytale is built with modding as a first-class feature. The game itself was built using the same tools exposed to modders. Official quote from Technical Director: "Most of what you see in the game can be changed, extended, or removed entirely."

### Mod types (four layers)
1. **Java Plugins** (`.jar` files)
   - Most powerful tier. Written in Java 25, use the server-side plugin API.
   - Build minigames, economies, custom commands, new asset types.
   - Use an Entity Component System (ECS) called Flecs — data-oriented, not inheritance-based.
   - Event system: EventBus + ECS pattern.
   - Each plugin has a `manifest.json` declaring: id, name, version, author, hytale_version, dependencies, permissions.
   - Published to CurseForge as "Plugins" category.

2. **Data Assets** (JSON files)
   - Drive blocks, items, NPCs, world generation, crafting recipes, drop tables.
   - No coding required — edited in the built-in Asset Editor.
   - Published to CurseForge as "Packs" category.

3. **Art Assets**
   - 3D models, textures, animations — authored in Blockbench (official plugin available) or the in-game Hytale Model Maker (browser-based, supports real-time collaboration).
   - Animation system supports inverse kinematics.
   - Bundled with plugins or data packs.

4. **World Saves / Prefabs**
   - Shareable world files and prefab structures for world generation.

### Visual Scripting (coming soon)
- Node-based system inspired by Unreal Engine Blueprints.
- Intentional decision to NOT use text-based scripting (no Lua, no JS).
- Designers build logic visually; programmers extend by adding new nodes in Java.
- Not yet shipped as of EA launch but planned for a future update.
- When it ships it will add a new mod asset type ("behavior packs") to the distribution ecosystem.

### Auto-sync
- Server-side mods are automatically distributed to connecting clients.
- Players do not need to pre-install mods to join a modded server.
- This is a fundamental difference from Minecraft's modding model.

## 4. Mod Distribution — CurseForge

- **Official and exclusive partner**: Hypixel Studios partnered with CurseForge at launch (announced January 5, 2026).
- Hytale mod hub: `curseforge.com/hytale`
- All submissions go through a moderation/review process.
- Three CurseForge mod categories for Hytale:
  - `Packs` — asset/content packs (JSON, models, textures)
  - `Plugins` — Java JAR server plugins
  - `Early Plugins` — bootstrap plugins for low-level class transforms (advanced)
- **CurseForge REST API** (`api.curseforge.com`) — requires an API key (free from CurseForge for developers). Supports: search by game, category, sort, pagination; mod detail; file listing; file download URL; changelog; dependencies.
- CurseForge desktop app handles downloads, version tracking, and mod-to-world assignment.
- Growth stats (as of late Feb 2026): 500+ mods published, 5M+ total downloads, 300+ unique creators.
- **Modrinth**: explicitly does NOT support Hytale and has no plans to in the near term. CurseForge is the only official platform.

## 5. Server Discovery

- Official in-game server browser shipping with **Update 5**.
- Pre-registration open now via Hytale Account Manager → Server Profiles.
- Server types: Survival, Adventure/RPG, Creative, PvP, Minigames, Roleplay, Social, Sandbox, Other.
- Audience tags: Everyone, Teen, Mature.
- Regions: 10 options across NA, South America, EU, Middle East, Asia, Oceania.
- Domain verification via DNS TXT record.
- Discovery token: server pings the discovery API every 2 minutes. If silent for >2 minutes, server is hidden from listings automatically.
- One listing per game profile.

## 6. Community Resources

| Resource | URL / Notes |
|---|---|
| Official modding strategy post | `hytale.com/news/2025/11/hytale-modding-strategy-and-status` |
| Official server list post | `hytale.com/news/2026/4/official-server-lists` |
| Britakee Studios GitBook | Comprehensive tested tutorials for Packs and Plugins |
| HytaleDocs.com | Community wiki and API reference |
| Hytale-Toolkit (GitHub) | Decompiled source, javadocs, semantic code search |
| Patcher (GitHub) | Browse the server JAR as an IntelliJ project |
| HytaleModding.dev | Guides, docs, tools — 8,000+ Discord members |
| r/hytale | Reddit community |
| CurseForge Hytale | `curseforge.com/hytale` |

## 7. Known Pain Points for Server Operators

- No dedicated GUI server manager exists yet for Hytale — this is an open gap.
- Mod folder path may change between EA updates.
- Java 25 (Adoptium) is required — mismatched JVM versions cause silent failures.
- Config file format is still stabilising — some keys change between updates.
- No official plugin Javadoc yet (server source release was expected by March 2026 — check current status).
- Visual scripting not yet shipped — "behavior pack" mod type doesn't exist yet but will.
- CurseForge API key required for programmatic access — users must supply their own or developer applies for a project key.
- Server crashes need manual restart unless the operator builds automation.
- No built-in update notification system for server operators — must check CurseForge manually.
