/**
 * Package root: the Host half this bundle mounts in the profile.
 *
 * The client module scanner discovers a package's browser half through a Loader
 * row that names the package *root* — a subpath entry is not a client row — so
 * the profile mounts this module and gets the Plugins-page version card.
 *
 * The preset must own everything else. Mounting the real plugin here would
 * register the role sections, the playbooks, and the Agent Teams lock for every
 * session in the profile, so this row deliberately does nothing:
 *
 * - the preset-scoped plugin lives in `./preset` (row `team-mode` inside the
 *   `team` agent preset);
 * - the version card lives in `./client` (browser half of this package).
 *
 * @module dsh-team-mode
 */

/**
 * Plugin entry: no Host-side behavior.
 */
export function apply() {}
