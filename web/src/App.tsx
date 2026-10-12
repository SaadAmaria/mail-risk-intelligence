import { useEffect, useRef, useState } from "react";
import type { IngestResponse } from "@mri/shared";
import { api } from "./lib/api";
import { announce } from "./lib/announce";
import { aiConnection } from "./lib/copy";
import { useDebounced, useMinWidth, useResource } from "./lib/hooks";
import { useMailbox } from "./lib/mailbox";
import { buildUrl, DEFAULT_ROUTE, navigateTo, useRoute } from "./lib/router";
import { AddEmail } from "./components/AddEmail";
import { Dialog } from "./components/Dialog";
import { Icon } from "./components/Icon";
import { InboxPane } from "./components/InboxPane";
import { InvestigationPane } from "./components/InvestigationPane";
import { GraphPage } from "./components/graph/GraphPage";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { Link } from "./components/Link";
import { Callout } from "./components/ui";
import { Welcome } from "./components/Welcome";
import s from "./App.module.css";

export function App() {
  const [route, go] = useRoute();
  const wide = useMinWidth(900);
  const health = useResource((signal) => api.health(signal), []);
  const mailbox = useMailbox(route, route.q);
  const aiConfigured = health.data?.llm.configured ?? false;
  const conn = aiConnection(health.data?.llm, health.data?.replay);
  // Recorded replay is shown only when the backend really is in that mode (no live model configured).
  const replayMode = !health.error && Boolean(health.data && !health.data.llm.configured && health.data.replay?.available);

  // Search text: typing is immediate, the URL and the request follow after a short pause.
  const [query, setQuery] = useState(route.q);
  const debounced = useDebounced(query, 250);
  const pushed = useRef(route.q);
  useEffect(() => {
    if (debounced.trim() !== route.q.trim()) {
      pushed.current = debounced;
      go({ q: debounced }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    // Back/Forward or a deep link changed the URL's search: reflect it in the box.
    if (route.q !== pushed.current.trim() && route.q !== query) setQuery(route.q);
    pushed.current = route.q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.q]);

  const onAdded = (r: IngestResponse) => {
    mailbox.refresh();
    health.reload();
    navigateTo(buildUrl({ ...route, emailId: r.id, add: false }));
    announce(
      r.created
        ? "Email added."
        : r.reason === "id_exists"
          ? "An email with this id was already in the mailbox. Showing it."
          : "This content was already in the mailbox. Showing the existing message.",
    );
  };

  const listHref = buildUrl({ ...route, emailId: null, add: false });
  const onGraph = route.page === "graph" && route.emailId === null;
  // Re-read the graph only when the set of analyzed messages changes.
  const graphKey = (mailbox.overview.data?.emails ?? []).filter((e) => e.processing.status !== "not_started" && !e.processing.in_progress).length;
  const showList = wide || route.emailId === null;
  const showDetail = wide || route.emailId !== null;

  return (
    <div className={s.app}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Skip to content
      </a>
      <header className={s.header}>
        <div className={s.brand}>
          <span className={s.logo}>
            <Icon name="logo" size={20} />
          </span>
          <span className={s.wordmark}>
            <span className={s.title}>
              Mail Risk <span>Intelligence</span>
            </span>
            <span className={s.tagline}>Evidence-first email investigation</span>
          </span>
        </div>
        <ConnectionStatus
          pillClass={[s.conn, conn.tone === "ok" ? s.ok : conn.tone === "warn" ? s.warn : ""].join(" ")}
          dotClass={s.connDot ?? ""}
          fullClass={s.connFull ?? ""}
          shortClass={s.connShort ?? ""}
          text={health.error ? "API unreachable" : conn.text}
          short={health.error ? "API down" : conn.short}
          title={health.data?.llm.model ?? undefined}
          replay={replayMode}
        />
      </header>

      <nav className={s.subnav} aria-label="Primary">
        <Link href={buildUrl(DEFAULT_ROUTE)} aria-current={!onGraph ? "page" : undefined} className={s.navLink}>
          Inbox
        </Link>
        <Link href={buildUrl({ ...DEFAULT_ROUTE, page: "graph" })} aria-current={onGraph ? "page" : undefined} className={s.navLink}>
          Knowledge graph
        </Link>
      </nav>

      {health.error && !health.data && (
        <div className={s.banner}>
          <Callout tone="warn" icon="alert-circle" role="status" title="Cannot reach the server">
            <p>The mailbox may not load until the API is running.</p>
          </Callout>
        </div>
      )}

      <main id="main" tabIndex={-1} className={`${s.main} ${wide && !onGraph ? s.wide : ""}`}>
        {onGraph && (
          <div className={s.detailCol}>
            <GraphPage
              route={route}
              onRoute={go}
              emails={mailbox.overview.data?.emails ?? null}
              totalEmails={mailbox.overview.data?.total ?? null}
              refreshKey={graphKey}
            />
          </div>
        )}
        {!onGraph && showList && (
          <div className={s.listCol}>
            {/* On a narrow screen the list is the whole page; give it a page heading (wide screens have one). */}
            {!wide && <h1 className="sr-only">Mailbox</h1>}
            <InboxPane
              route={route}
              query={query}
              onQuery={setQuery}
              onRoute={go}
              mailbox={mailbox}
              aiConfigured={aiConfigured}
              onAdd={() => go({ add: true })}
            />
          </div>
        )}
        {!onGraph && showDetail && (
          <div className={s.detailCol}>
            {route.emailId ? (
              <InvestigationPane
                key={route.emailId}
                id={route.emailId}
                aiConfigured={aiConfigured}
                replay={health.data?.replay}
                backHref={listHref}
                onChanged={() => {
                  mailbox.refresh();
                  health.reload();
                }}
              />
            ) : (
              <Welcome
                overview={mailbox.overview.data}
                loading={mailbox.overview.loading}
                aiConfigured={aiConfigured}
                onAdd={() => go({ add: true })}
              />
            )}
          </div>
        )}
      </main>

      <Dialog open={route.add} title="Add an email" onClose={() => go({ add: false })}>
        <AddEmail aiConfigured={aiConfigured} replayAvailable={Boolean(health.data?.replay?.available)} onDone={onAdded} onCancel={() => go({ add: false })} />
      </Dialog>

      <div id="announcer" className="sr-only" role="status" aria-live="polite" />
    </div>
  );
}
