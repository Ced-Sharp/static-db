# Static DB

**Static DB** is a Git-backed local-first CMS data layer that enables building small, single-user content management systems with zero infrastructure costs. The library provides a robust, pluggable data layer that treats Git repositories as databases while maintaining local-first performance and offline capabilities.

## Core Architecture

Static DB implements a clean separation between remote storage backends and local persistence, orchestrated through a simple sync service that follows a "remote is source of truth" conflict policy:

- **Remote Database Abstraction**: Pluggable adapters for GitHub, GitLab, Firebase, and other backends
- **Local Database**: Platform-specific persistence:
  - **Browser**: IndexedDB-based client storage with fallback to memory storage
  - **Node.js**: File-based JSON storage with fallback to memory storage
- **Sync Service**: Simple snapshot-based synchronization with conflict resolution
- **Data Model**: Schema-driven CMS with support for entities, relations, and metadata

## Technologies Used

This project uses a modern TypeScript toolchain focused on performance, developer experience, and cross-platform compatibility.

### Core Technologies

- **TypeScript 5.9+**: Type-safe development with strict configuration
- **ESM (ES Modules)**: Pure module project with modern import/export syntax
- **Node.js 20+**: Minimum runtime requirement

### Development Tools

- **Biome 2.2.3**: All-in-one linting and formatting tool
  - Replaces ESLint + Prettier combination
  - Fast performance with Rust-based implementation
  - Configured with double quotes, space indentation, and import organization
  - Git integration with ignore file support

- **Vitest 3.2.4**: Modern testing framework
  - Istanbul coverage provider with LCOV reporting
  - Strict coverage thresholds (75% branches, 95%+ for others)
  - Fast test execution with watch mode support

- **tsdown 0.15.0**: TypeScript bundler
  - Creates separate builds for Node.js and browser environments
  - Generates declaration files (.d.ts) for both platforms
  - Browser build is minified for production use
  - Source maps included for debugging

### Build & Release

- **Size Limit**: Bundle size analysis with 3.5KB limit for browser build
- **Dual Package Exports**:
  - Main entry (`.`) for Node.js environments
  - Browser entry (`./browser`) optimized for client-side use

### Project Architecture

The project follows a careful separation between runtime-agnostic and runtime-specific code:

#### Source Structure
```
src/
├── internal.ts    # Core logic, runtime-agnostic
├── index.ts       # Node.js adapter with Node-specific APIs
└── browser.ts     # Browser adapter with web APIs
```

#### Build Targets
- **Node.js Build** (`dist/index.js`): Full Node.js API access including `crypto.randomBytes`
- **Browser Build** (`dist/browser.js`): Web-compatible using `crypto.getRandomValues`

#### Runtime Separation Pattern
- `internal.ts`: Contains pure JavaScript/TypeScript functionality
- `index.ts`: Node.js-specific implementations using `node:crypto`
- `browser.ts`: Browser-specific implementations using Web Crypto API

## Available Scripts

```bash
# Build both Node.js and browser versions
pnpm build

# Development mode with file watching
pnpm dev

# Lint and format code (Biome)
pnpm lint      # Check code quality and formatting
pnpm format    # Auto-format code

# Testing
pnpm test      # Run tests with coverage

# Bundle size analysis
pnpm size      # Check if bundle meets size limits
```

## Package Configuration

### Exports
- Main export: `./dist/index.js` (Node.js)
- Browser export: `./dist/browser.js` (Browser optimized)
- TypeScript definitions: Generated for both exports

### Development Standards
- Strict TypeScript configuration with no unused locals
- ESM-only with no CommonJS support
- Side effects marked as false for tree-shaking
- Engine requirement: Node.js 20+

## Quality Assurance

- **Coverage Requirements**: Minimum 95% coverage for functions, lines, and statements; 75% for branches
- **Bundle Size Limit**: Browser build must stay under 3.5KB
- **Code Quality**: Biome enforces consistent formatting and linting rules
- **Type Safety**: Strict TypeScript with declaration generation