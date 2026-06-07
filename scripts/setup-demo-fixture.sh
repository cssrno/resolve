#!/usr/bin/env bash
#
# Sets up /tmp/conflict-vscode-demo as a real git repo with an active
# rebase + an active merge conflict on the SAME file. Used to capture
# the marketplace screenshots / video walkthrough described in
# docs/VIDEO_SCRIPT.md.
#
# Run from anywhere; the repo is reset every time.

set -euo pipefail

REPO=/tmp/conflict-vscode-demo
SRC_BASE="$(cd "$(dirname "$0")/.." && pwd)/fixtures/demo/class-lockdown-blocks.base.php"
FILE_REL="wp-content/mu-plugins/mirage-core/includes/class-lockdown-blocks.php"

rm -rf "$REPO"
mkdir -p "$REPO/wp-content/mu-plugins/mirage-core/includes"
cd "$REPO"

git init -q -b main
git config user.email demo@mirageclab.local
git config user.name "Demo User"

# ----- commit 1: import base file -----
cp "$SRC_BASE" "$FILE_REL"
git add "$FILE_REL"
git commit -q -m "Initial import of class-lockdown-blocks"

# ----- commit 2: small refactor on main, becomes the rebase target -----
python3 - <<'PY'
from pathlib import Path
p = Path("wp-content/mu-plugins/mirage-core/includes/class-lockdown-blocks.php")
text = p.read_text()
text = text.replace(
    "    private function inline_styles(): string {",
    "    private function inline_styles(): string {\n        // Tightened spec @ 2026-05 — keep banner radius in sync with corp.\n"
)
p.write_text(text)
PY
git add "$FILE_REL"
git commit -q -m "Tighten lockdown banner spec"

# ----- feature branch with conflicting edits -----
git checkout -q -b feature/mcl-73-securite-finir-la-mise-en-page

python3 - <<'PY'
from pathlib import Path
p = Path("wp-content/mu-plugins/mirage-core/includes/class-lockdown-blocks.php")
text = p.read_text()
# Conflict 1: methodA — rename + body change.
text = text.replace(
    "    public function render_lockdown_banner( int $post_id ): string {\n        $title   = get_the_title( $post_id );\n        $message = $this->banner_message( $post_id );\n        return sprintf(\n            '<aside class=\"lockdown-banner\" data-post-id=\"%d\"><h2>%s</h2><p>%s</p></aside>',\n            $post_id,\n            esc_html( $title ),\n            wp_kses_post( $message )\n        );\n    }",
    "    public function render_lockdown_paywall_banner( int $post_id, ?string $cta_label = null ): string {\n        $title   = get_the_title( $post_id );\n        $message = $this->banner_message( $post_id );\n        $cta     = $cta_label ?? __( 'Subscribe to unlock', 'mirage-lockdown' );\n        return sprintf(\n            '<aside class=\"lockdown-banner lockdown-banner--paywall\" data-post-id=\"%d\"><h2>%s</h2><p>%s</p><button>%s</button></aside>',\n            $post_id,\n            esc_html( $title ),\n            wp_kses_post( $message ),\n            esc_html( $cta )\n        );\n    }",
)
# Conflict 2: a localAdd — new method between two existing ones.
text = text.replace(
    "    public function fetch_recent_posts( int $limit ): array {",
    "    public function fetch_pinned_posts(): array {\n        return get_posts( [ 'post__in' => (array) get_option( 'lockdown_pinned_post_ids', [] ) ] );\n    }\n\n    public function fetch_recent_posts( int $limit ): array {",
)
# Conflict 3: a localMod on inline_styles.
text = text.replace(
    "        return '.lockdown-banner{padding:24px;background:#f5f5f5;border-radius:6px;}'",
    "        return '.lockdown-banner{padding:32px 24px;background:linear-gradient(180deg,#fafafa,#f0f0f0);border-radius:8px;}'",
)
p.write_text(text)
PY
git add "$FILE_REL"
git commit -q -m "Add paywall CTA + pinned-posts query + restyle banner gradient"

# ----- divergent edits on main (= rebase onto / merge counterpart) -----
git checkout -q main
python3 - <<'PY'
from pathlib import Path
p = Path("wp-content/mu-plugins/mirage-core/includes/class-lockdown-blocks.php")
text = p.read_text()
# Same regions, but different changes => 3-way conflicts on rebase.
text = text.replace(
    "    public function render_lockdown_banner( int $post_id ): string {\n        $title   = get_the_title( $post_id );\n        $message = $this->banner_message( $post_id );\n        return sprintf(\n            '<aside class=\"lockdown-banner\" data-post-id=\"%d\"><h2>%s</h2><p>%s</p></aside>',\n            $post_id,\n            esc_html( $title ),\n            wp_kses_post( $message )\n        );\n    }",
    "    public function render_lockdown_banner( int $post_id, array $args = [] ): string {\n        $title   = get_the_title( $post_id );\n        $message = $this->banner_message( $post_id );\n        $classes = 'lockdown-banner' . ( ! empty( $args['compact'] ) ? ' is-compact' : '' );\n        return sprintf(\n            '<aside class=\"%s\" data-post-id=\"%d\" role=\"complementary\"><h2>%s</h2><p>%s</p></aside>',\n            esc_attr( $classes ),\n            $post_id,\n            esc_html( $title ),\n            wp_kses_post( $message )\n        );\n    }",
)
text = text.replace(
    "        return '.lockdown-banner{padding:24px;background:#f5f5f5;border-radius:6px;}'",
    "        return '.lockdown-banner{padding:24px;background:#fff;border:1px solid #e1e1e1;border-radius:6px;}'",
)
p.write_text(text)
PY
git add "$FILE_REL"
git commit -q -m "Banner: add compact variant + neutral background"

# ----- trigger conflict via rebase -----
git checkout -q feature/mcl-73-securite-finir-la-mise-en-page
set +e
git rebase main >/tmp/rebase.log 2>&1
REBASE_STATUS=$?
set -e

echo
echo "Demo repo ready at: $REPO"
echo "Conflicted file:    $REPO/$FILE_REL"
echo
if [ $REBASE_STATUS -ne 0 ]; then
  echo "Rebase is paused on conflicts (expected) — open the file in VSCode."
else
  echo "Rebase completed without conflicts — re-run if you wanted the conflict state."
fi
echo
echo "Next:"
echo "  1. Launch the dev host (F5 in this extension's workspace)."
echo "  2. File > Open Folder > $REPO"
echo "  3. Open $FILE_REL — the merge view auto-opens."
echo "  4. The Local / Remote headers should now show 'Rebasing ... from feature/...'."
