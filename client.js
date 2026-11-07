window.__ModuleLoader__.load({
  id: 'dsh-spotlight',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Cache for loaded session messages: sessionId -> Array of { role, text, time }
    const sessionMessagesCache = new Map();

    // Clean text and extract user / assistant dialogue from raw events
    function extractMessages(entries) {
      const msgs = [];
      if (!entries || !Array.isArray(entries)) return msgs;
      for (const entry of entries) {
        if (entry.type !== 'event' || !entry.event) continue;
        const ev = entry.event;
        if (ev.type === 'user/message') {
          const parts = ev.data?.content || [];
          const textParts = [];
          for (const p of parts) {
            if (p.type === 'text' && p.text) {
              const clean = p.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
              if (clean) textParts.push(clean);
            }
          }
          const text = textParts.join('\n').trim();
          if (text) {
            msgs.push({ role: 'user', text, time: ev.time });
          }
        } else if (ev.type === 'assistant/message') {
          const parts = ev.data?.message?.content || [];
          const textParts = [];
          for (const p of parts) {
            if (p.type === 'text' && p.text) {
              textParts.push(p.text);
            }
          }
          const text = textParts.join('\n').trim();
          if (text) {
            msgs.push({ role: 'assistant', text, time: ev.time });
          }
        }
      }
      return msgs;
    }

    // Highlight search match in text using native React elements
    function renderHighlighted(text, query) {
      if (!text) return '';
      if (!query || !query.trim()) return text;
      const q = query.trim();
      const lowerText = text.toLowerCase();
      const lowerQ = q.toLowerCase();
      const parts = [];
      let lastIdx = 0;
      let matchIdx = lowerText.indexOf(lowerQ, lastIdx);

      while (matchIdx !== -1) {
        if (matchIdx > lastIdx) {
          parts.push(text.slice(lastIdx, matchIdx));
        }
        parts.push(
          h('span', {
            key: matchIdx,
            className: 'dsh-spotlight-highlight'
          }, text.slice(matchIdx, matchIdx + q.length))
        );
        lastIdx = matchIdx + q.length;
        matchIdx = lowerText.indexOf(lowerQ, lastIdx);
      }
      if (lastIdx < text.length) {
        parts.push(text.slice(lastIdx));
      }
      return parts;
    }

    // Format relative or date time
    function formatTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString();
    }

    // Modal dialog component rendered in shell.overlay
    function SpotlightModal(props) {
      const { ctx } = props;
      const [isOpen, setIsOpen] = React.useState(false);
      const [query, setQuery] = React.useState('');
      // filterMode: 'all' | 'session' | 'chat'
      const [filterMode, setFilterMode] = React.useState('all');
      const [remoteChatResults, setRemoteChatResults] = React.useState([]);
      const [isSearchingChat, setIsSearchingChat] = React.useState(false);
      const [selectedIndex, setSelectedIndex] = React.useState(0);

      // Selected session preview state
      const [previewContent, setPreviewContent] = React.useState(null);
      const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);

      const inputRef = React.useRef(null);
      const listContainerRef = React.useRef(null);
      const previewContainerRef = React.useRef(null);
      const abortCtrlRef = React.useRef(null);
      const lastClickRef = React.useRef({ time: 0, id: null });

      // Keep shell.overlay above mobile sidebar drawer (z-index: 71)
      React.useEffect(() => {
        if (!isOpen) return;
        const overlayEl = document.querySelector('[data-shell-overlay], [class*="overlayLayer"]');
        if (overlayEl) {
          const prevZ = overlayEl.style.zIndex;
          overlayEl.style.zIndex = '1000';
          return () => {
            overlayEl.style.zIndex = prevZ;
          };
        }
      }, [isOpen]);

      // Sessions snapshot from client session store
      const [sessionList, setSessionList] = React.useState(() => {
        return ctx.sessions?.list?.getSnapshot() || { byId: {}, ids: [] };
      });

      React.useEffect(() => {
        if (!ctx.sessions?.list?.subscribe) return;
        return ctx.sessions.list.subscribe(() => {
          setSessionList(ctx.sessions.list.getSnapshot());
        });
      }, [ctx]);

      // Cache live sessions immediately
      React.useEffect(() => {
        const byId = sessionList.byId || {};
        for (const id of Object.keys(byId)) {
          const binding = ctx.sessions?.binding(id);
          if (binding?.eventSource) {
            const entries = binding.eventSource.getSnapshot()?.entries || [];
            const msgs = extractMessages(entries);
            if (msgs.length > 0) {
              sessionMessagesCache.set(id, msgs);
            }
          }
        }
      }, [sessionList, ctx]);

      // Open/close listeners
      React.useEffect(() => {
        const collapseMobileSidebar = () => {
          if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
            const frame = document.querySelector('[class*="_frame"], [data-dsh-frame]');
            if (frame && !frame.hasAttribute('data-sidebar-collapsed')) {
              const toggle = document.querySelector('button[data-sidebar-toggle]');
              if (toggle) toggle.click();
              else {
                const lay = ctx.get('layout') || ctx.layout;
                if (lay && typeof lay.toggleSidebar === 'function') lay.toggleSidebar();
              }
            }
          }
        };

        const handleOpen = (e) => {
          setIsOpen(true);
          collapseMobileSidebar();
          if (e && e.detail && typeof e.detail.query === 'string') {
            setQuery(e.detail.query);
          }
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.focus();
              const isTouch = typeof window !== 'undefined' && (
                (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ||
                ('ontouchstart' in window)
              );
              if (!isTouch) {
                inputRef.current.select();
              }
            }
          }, 50);
        };
        const handleClose = () => setIsOpen(false);

        window.addEventListener('dsh:spotlight:open', handleOpen);
        window.addEventListener('dsh:spotlight:close', handleClose);
        return () => {
          window.removeEventListener('dsh:spotlight:open', handleOpen);
          window.removeEventListener('dsh:spotlight:close', handleClose);
        };
      }, []);

      // Search chat messages (both local cache and remote session search)
      React.useEffect(() => {
        const q = query.trim();
        if (!q || filterMode === 'session') {
          setRemoteChatResults([]);
          setIsSearchingChat(false);
          return;
        }

        if (abortCtrlRef.current) {
          abortCtrlRef.current.abort();
        }
        const ctrl = new AbortController();
        abortCtrlRef.current = ctrl;
        setIsSearchingChat(true);

        const timer = setTimeout(async () => {
          try {
            if (ctx.sessions?.search) {
              const res = await ctx.sessions.search(q, ctrl.signal);
              if (!ctrl.signal.aborted && res && res.ok && res.value && Array.isArray(res.value.items)) {
                setRemoteChatResults(res.value.items);
              }
            }
          } catch (err) {
            if (!ctrl.signal.aborted) {
              setRemoteChatResults([]);
            }
          } finally {
            if (!ctrl.signal.aborted) {
              setIsSearchingChat(false);
            }
          }
        }, 160);

        return () => {
          clearTimeout(timer);
          ctrl.abort();
        };
      }, [query, filterMode, ctx]);

      // Calculate combined results (Sessions + Local Chat + Remote Chat)
      const results = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        const byId = sessionList.byId || {};
        const allSessions = Object.values(byId).filter(s => s && !s.blank);

        // 1. Session matches
        let sessionMatches = [];
        if (filterMode === 'all' || filterMode === 'session') {
          if (q) {
            sessionMatches = allSessions
              .filter(s => {
                const title = (s.title || s.displayTitle || '').trim().toLowerCase();
                const cwd = (s.cwd || '').toLowerCase();
                return title.includes(q) || cwd.includes(q);
              })
              .map(s => ({
                id: `session:${s.id}`,
                type: 'session',
                sessionId: s.id,
                title: s.title || s.displayTitle || 'Untitled Session',
                cwd: s.cwd || '',
                updatedAt: s.updatedAt || s.createdAt || 0,
                running: s.running || false
              }));
          } else {
            sessionMatches = [...allSessions]
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .slice(0, 20)
              .map(s => ({
                id: `session:${s.id}`,
                type: 'session',
                sessionId: s.id,
                title: s.title || s.displayTitle || 'Untitled Session',
                cwd: s.cwd || '',
                updatedAt: s.updatedAt || s.createdAt || 0,
                running: s.running || false
              }));
          }
        }

        // 2. Chat matches
        let chatMatches = [];
        if (q && (filterMode === 'all' || filterMode === 'chat')) {
          const seenChatSessionIds = new Set();

          // A. Scan cached / active sessions directly (ensures current conversation is immediately found!)
          for (const [sId, msgs] of sessionMessagesCache.entries()) {
            const sess = byId[sId];
            for (let mIdx = 0; mIdx < msgs.length; mIdx++) {
              const msg = msgs[mIdx];
              if (msg.text.toLowerCase().includes(q)) {
                // Find matching line snippet
                const lines = msg.text.split('\n');
                const matchedLine = lines.find(l => l.toLowerCase().includes(q)) || lines[0];
                seenChatSessionIds.add(sId);
                chatMatches.push({
                  id: `chat:local:${sId}:${mIdx}`,
                  type: 'chat',
                  sessionId: sId,
                  title: sess?.title || sess?.displayTitle || 'Session',
                  snippet: matchedLine.trim().slice(0, 160),
                  cwd: sess?.cwd || '',
                  updatedAt: sess?.updatedAt || 0,
                  running: sess?.running || false
                });
                break; // One primary match per session
              }
            }
          }

          // B. Append remote search items
          for (const item of remoteChatResults) {
            if (!seenChatSessionIds.has(item.sessionId)) {
              seenChatSessionIds.add(item.sessionId);
              const sess = byId[item.sessionId];
              chatMatches.push({
                id: `chat:remote:${item.sessionId}`,
                type: 'chat',
                sessionId: item.sessionId,
                title: sess?.title || sess?.displayTitle || 'Session',
                snippet: (item.snippet || '').replace(/\n+/g, ' ').slice(0, 160),
                cwd: sess?.cwd || '',
                updatedAt: sess?.updatedAt || 0,
                running: sess?.running || false
              });
            }
          }
        }

        return [...sessionMatches, ...chatMatches];
      }, [query, filterMode, sessionList, remoteChatResults]);

      // Reset selection when results change
      React.useEffect(() => {
        setSelectedIndex(0);
      }, [query, filterMode]);

      // Ensure selected row is scrolled into view in list
      React.useEffect(() => {
        if (!listContainerRef.current) return;
        const selectedEl = listContainerRef.current.querySelector('.dsh-spotlight-item-selected');
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'nearest' });
        }
      }, [selectedIndex]);

      const currentSelected = results[selectedIndex] || results[0];

      // Load conversation messages for preview whenever selected session changes
      React.useEffect(() => {
        if (!currentSelected?.sessionId) {
          setPreviewContent(null);
          return;
        }

        const sessionId = currentSelected.sessionId;

        // Check cache
        if (sessionMessagesCache.has(sessionId)) {
          setPreviewContent({
            sessionId,
            messages: sessionMessagesCache.get(sessionId)
          });
          return;
        }

        // Check if session is live in client binding
        const liveBinding = ctx.sessions?.binding(sessionId);
        if (liveBinding?.eventSource) {
          const entries = liveBinding.eventSource.getSnapshot()?.entries || [];
          const msgs = extractMessages(entries);
          sessionMessagesCache.set(sessionId, msgs);
          setPreviewContent({ sessionId, messages: msgs });
          return;
        }

        // Otherwise load via ctx.sessions.using
        let isCancelled = false;
        setIsLoadingPreview(true);

        if (ctx.sessions?.using) {
          ctx.sessions.using(sessionId, { source: 'spotlightPreview' }, async (reference) => {
            await reference.ready;
            if (isCancelled) return;
            const entries = reference.binding?.eventSource?.getSnapshot()?.entries || [];
            const msgs = extractMessages(entries);
            sessionMessagesCache.set(sessionId, msgs);
            if (!isCancelled) {
              setPreviewContent({ sessionId, messages: msgs });
              setIsLoadingPreview(false);
            }
          }).catch(() => {
            if (!isCancelled) {
              setIsLoadingPreview(false);
            }
          });
        } else {
          setIsLoadingPreview(false);
        }

        return () => {
          isCancelled = true;
        };
      }, [currentSelected?.sessionId, ctx]);

      // Auto-scroll preview pane to matching line if present
      React.useEffect(() => {
        if (!previewContainerRef.current) return;
        const matchedLine = previewContainerRef.current.querySelector('.dsh-spotlight-line-matched');
        if (matchedLine) {
          matchedLine.scrollIntoView({ block: 'center' });
        }
      }, [previewContent, query]);

      // Reliable session opener
      const openSession = (sessionId) => {
        if (!sessionId) return;
        setIsOpen(false);
        try {
          const uiWs = ctx.get('uiWorkspace') || ctx.uiWorkspace;
          if (uiWs && typeof uiWs.openSession === 'function') {
            uiWs.openSession(sessionId);
          } else if (ctx.sessions && typeof ctx.sessions.retain === 'function') {
            ctx.sessions.retain(sessionId, { source: 'mainView' });
          }
          const lay = ctx.get('layout') || ctx.layout;
          if (lay && typeof lay.selectPanel === 'function') {
            lay.selectPanel(null);
          }
          // ponytail: collapse sidebar on mobile if open; upgrade to gesture-synced transitions if requested
          if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
            if (lay && typeof lay.closeRightbar === 'function') {
              lay.closeRightbar();
            }
          }
          const frame = typeof document !== 'undefined' && document.querySelector('[class*="_frame"], [data-dsh-frame]');
          if (frame && !frame.hasAttribute('data-sidebar-collapsed')) {
            const toggle = document.querySelector('button[data-sidebar-toggle]');
            if (toggle) {
              toggle.click();
            } else if (lay && typeof lay.toggleSidebar === 'function') {
              lay.toggleSidebar();
            }
          }
        } catch (err) {
          console.error('Failed to open session:', err);
        }
      };

      // Row click handler: single-tap opens on mobile, single-click selects on desktop
      const handleRowClick = (idx, item) => {
        const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
          openSession(item.sessionId);
          return;
        }
        setSelectedIndex(idx);
        const now = Date.now();
        if (lastClickRef.current.id === item.sessionId && (now - lastClickRef.current.time) < 400) {
          openSession(item.sessionId);
        }
        lastClickRef.current = { time: now, id: item.sessionId };
      };

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setIsOpen(false);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (currentSelected) {
            openSession(currentSelected.sessionId);
          }
        }
      };

      if (!isOpen) return null;

      // Extract conversation preview lines
      const previewLines = [];
      if (previewContent && previewContent.messages) {
        let lineCounter = 1;
        for (const msg of previewContent.messages) {
          const roleLabel = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
          previewLines.push({
            isHeader: true,
            role: msg.role,
            text: `── ${roleLabel} ──`
          });
          const textLines = msg.text.split('\n');
          for (const line of textLines) {
            previewLines.push({
              isHeader: false,
              lineNum: lineCounter++,
              text: line,
              hasMatch: query && line.toLowerCase().includes(query.toLowerCase().trim())
            });
          }
        }
      }

      return h('div', {
        className: 'dsh-spotlight-overlay',
        onClick: (e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            e.stopPropagation();
            setTimeout(() => {
              setIsOpen(false);
            }, 60);
          }
        }
      }, h('div', {
        className: 'dsh-spotlight-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Spotlight Search',
        onKeyDown: handleKeyDown
      },
        // 1. Apple Spotlight Search Bar (Image 1)
        h('div', { className: 'dsh-spotlight-header' },
          h('div', { className: 'dsh-spotlight-search-box' },
            h('svg', {
              className: 'dsh-spotlight-search-icon',
              viewBox: '0 0 24 24',
              width: 20,
              height: 20,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              h('circle', { cx: 11, cy: 11, r: 8 }),
              h('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
            ),
            h('input', {
              ref: inputRef,
              className: 'dsh-spotlight-input',
              type: 'text',
              placeholder: 'Spotlight Search...',
              value: query,
              autoFocus: true,
              onChange: (e) => setQuery(e.target.value)
            }),
            query && h('button', {
              className: 'dsh-spotlight-clear-btn',
              type: 'button',
              title: 'Clear search',
              onClick: () => {
                setQuery('');
                if (inputRef.current) inputRef.current.focus();
              }
            }, '✕')
          ),
          // Filter toggle buttons on right (Apple Spotlight style)
          h('div', { className: 'dsh-spotlight-filters' },
            h('button', {
              type: 'button',
              className: `dsh-spotlight-filter-btn ${filterMode === 'session' ? 'active' : ''}`,
              title: 'Filter: Session names only',
              onClick: () => setFilterMode(prev => prev === 'session' ? 'all' : 'session')
            },
              h('svg', {
                viewBox: '0 0 24 24',
                width: 14,
                height: 14,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2
              },
                h('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' })
              ),
              h('span', null, 'Sessions')
            ),
            h('button', {
              type: 'button',
              className: `dsh-spotlight-filter-btn ${filterMode === 'chat' ? 'active' : ''}`,
              title: 'Filter: Chat messages only',
              onClick: () => setFilterMode(prev => prev === 'chat' ? 'all' : 'chat')
            },
              h('svg', {
                viewBox: '0 0 24 24',
                width: 14,
                height: 14,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2
              },
                h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
              ),
              h('span', null, 'Chat')
            )
          ),
          h('button', {
            type: 'button',
            className: 'dsh-spotlight-close-btn',
            title: 'Close',
            'aria-label': 'Close',
            onPointerDown: (e) => {
              e.stopPropagation();
            },
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              // Delay unmount to let mobile touch sequence finish, preventing ghost-clicks on underlying header buttons
              setTimeout(() => {
                setIsOpen(false);
              }, 60);
            }
          }, '✕')
        ),

        // Subheader status line
        h('div', { className: 'dsh-spotlight-subheader' },
          h('span', null,
            isSearchingChat ? 'Searching chat messages...' :
            query ? `${results.length} matches found` : 'Recent sessions'
          ),
          h('span', { className: 'dsh-spotlight-filter-indicator' },
            filterMode === 'all' ? 'All (Sessions & Chat)' :
            filterMode === 'session' ? 'Sessions only' : 'Chat only'
          )
        ),

        // 2. Results List (IntelliJ Find in Path Top Pane - Image 2)
        h('div', {
          ref: listContainerRef,
          className: 'dsh-spotlight-list'
        },
          results.length === 0 ? (
            h('div', { className: 'dsh-spotlight-empty' },
              isSearchingChat ? 'Searching conversations...' : 'No matching results found.'
            )
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return h('div', {
                key: item.id,
                className: `dsh-spotlight-item ${isSelected ? 'dsh-spotlight-item-selected' : ''}`,
                onClick: () => handleRowClick(idx, item),
                onDoubleClick: () => openSession(item.sessionId)
              },
                // Match text with highlight
                h('div', { className: 'dsh-spotlight-item-left' },
                  h('span', {
                    className: `dsh-spotlight-badge ${item.type === 'session' ? 'badge-session' : 'badge-chat'}`
                  }, item.type === 'session' ? 'Session' : 'Chat'),
                  h('span', { className: 'dsh-spotlight-item-text' },
                    item.type === 'session'
                      ? renderHighlighted(item.title, query)
                      : renderHighlighted(item.snippet, query)
                  )
                ),
                // Session title / location and Quick Open action
                h('div', { className: 'dsh-spotlight-item-right' },
                  h('span', { className: 'dsh-spotlight-item-location' },
                    item.type === 'chat' ? item.title : (item.cwd || '')
                  ),
                  item.updatedAt > 0 && h('span', { className: 'dsh-spotlight-item-time' },
                    formatTime(item.updatedAt)
                  ),
                  h('button', {
                    type: 'button',
                    className: 'dsh-spotlight-row-open-btn',
                    title: 'Open this session',
                    onClick: (e) => {
                      e.stopPropagation();
                      openSession(item.sessionId);
                    }
                  }, '↗')
                )
              );
            })
          )
        ),

        // 3. Conversation Preview Pane (IntelliJ Find in Path Bottom Pane - Image 2)
        currentSelected ? h('div', { className: 'dsh-spotlight-preview-pane' },
          // Header with Session title and path
          h('div', { className: 'dsh-spotlight-preview-header' },
            h('div', { className: 'dsh-spotlight-preview-title' },
              h('span', { className: 'preview-session-name' }, currentSelected.title),
              currentSelected.cwd && h('span', { className: 'preview-session-cwd' }, currentSelected.cwd)
            ),
            h('div', { className: 'dsh-spotlight-preview-meta' },
              currentSelected.running && h('span', { className: 'preview-status-running' }, '● Running'),
              h('span', null, formatTime(currentSelected.updatedAt))
            )
          ),
          // Code/Chat conversation body with line numbers like IntelliJ
          h('div', {
            ref: previewContainerRef,
            className: 'dsh-spotlight-preview-body'
          },
            isLoadingPreview ? (
              h('div', { className: 'dsh-spotlight-preview-loading' }, 'Loading conversation...')
            ) : previewLines.length > 0 ? (
              previewLines.map((line, lIdx) => {
                if (line.isHeader) {
                  return h('div', {
                    key: lIdx,
                    className: `dsh-spotlight-preview-msg-header ${line.role}`
                  }, line.text);
                }
                return h('div', {
                  key: lIdx,
                  className: `dsh-spotlight-line ${line.hasMatch ? 'dsh-spotlight-line-matched' : ''}`
                },
                  h('span', { className: 'dsh-spotlight-line-num' }, line.lineNum),
                  h('span', { className: 'dsh-spotlight-line-content' },
                    renderHighlighted(line.text, query)
                  )
                );
              })
            ) : (
              h('div', { className: 'dsh-spotlight-session-card' },
                h('div', { className: 'session-card-row' },
                  h('strong', null, 'Session ID: '),
                  h('code', null, currentSelected.sessionId)
                ),
                h('div', { className: 'session-card-row' },
                  h('strong', null, 'Working Directory: '),
                  h('span', null, currentSelected.cwd || 'Default workspace')
                ),
                h('div', { className: 'session-card-row' },
                  h('strong', null, 'Status: '),
                  h('span', null, currentSelected.running ? 'Running' : 'Idle')
                )
              )
            )
          )
        ) : null,

        // 4. Footer action bar (IntelliJ style)
        h('div', { className: 'dsh-spotlight-footer' },
          h('div', { className: 'dsh-spotlight-shortcuts' },
            h('span', { className: 'shortcut-key' }, '↑↓'), ' navigate',
            h('span', { className: 'shortcut-key' }, '↵'), ' open session',
            h('span', { className: 'shortcut-key' }, 'double-click'), ' open',
            h('span', { className: 'shortcut-key' }, 'esc'), ' close'
          ),
          currentSelected && h('button', {
            className: 'dsh-spotlight-open-btn',
            type: 'button',
            onClick: () => openSession(currentSelected.sessionId)
          }, 'Open Session ↵')
        )
      ));
    }

    // Stylesheet definition using high-contrast IntelliJ/macOS dark theme colors
    const STYLES = `
:is([data-shell-overlay], [class*="overlayLayer"]):has(.dsh-spotlight-overlay) {
  z-index: 1000 !important;
}

.dsh-spotlight-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 8vh;
  box-sizing: border-box;
}

.dsh-spotlight-dialog {
  width: 820px;
  max-width: 94vw;
  background: #1e1f22;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  animation: dsh-spotlight-appear 0.12s ease-out;
}

@keyframes dsh-spotlight-appear {
  from { opacity: 0; transform: scale(0.97) translateY(-6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* 1. Spotlight Search Bar Header */
.dsh-spotlight-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: #25262b;
}

.dsh-spotlight-search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #18191c;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  padding: 6px 14px;
}

.dsh-spotlight-search-icon {
  color: #94a3b8;
  flex-shrink: 0;
}

.dsh-spotlight-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 15px;
  color: #ffffff;
  line-height: 22px;
}

.dsh-spotlight-input::placeholder {
  color: #64748b;
}

.dsh-spotlight-clear-btn {
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 50%;
}
.dsh-spotlight-clear-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
}

.dsh-spotlight-filters {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsh-spotlight-filter-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.dsh-spotlight-filter-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.dsh-spotlight-filter-btn.active {
  background: #2563eb !important;
  border-color: #3b82f6 !important;
  color: #ffffff !important;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
}

/* Subheader */
.dsh-spotlight-subheader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 18px;
  background: #1e1f22;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 2. Results List (IntelliJ style) */
.dsh-spotlight-list {
  max-height: 220px;
  min-height: 100px;
  overflow-y: auto;
  background: #1e1f22;
}

.dsh-spotlight-empty {
  padding: 36px 18px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

.dsh-spotlight-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  gap: 12px;
  border-left: 3px solid transparent;
  transition: background 0.08s ease;
  user-select: none;
}

.dsh-spotlight-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

/* IntelliJ Selection Style: Vibrant Blue background, bright white text */
.dsh-spotlight-item.dsh-spotlight-item-selected {
  background: #214283 !important;
  color: #ffffff !important;
  border-left: 3px solid #3b82f6 !important;
}

.dsh-spotlight-item.dsh-spotlight-item-selected * {
  color: #ffffff !important;
}

.dsh-spotlight-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.dsh-spotlight-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.badge-session {
  background: rgba(16, 185, 129, 0.22);
  color: #34d399;
}

.badge-chat {
  background: rgba(99, 102, 241, 0.25);
  color: #a5b4fc;
}

.dsh-spotlight-item-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

/* Matched Term Highlight */
.dsh-spotlight-highlight {
  background: #eab308;
  color: #000000;
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 700;
}

.dsh-spotlight-item.dsh-spotlight-item-selected .dsh-spotlight-highlight {
  background: #f59e0b !important;
  color: #000000 !important;
}

.dsh-spotlight-item-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  font-size: 12px;
  color: #94a3b8;
}

.dsh-spotlight-item-location {
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dsh-spotlight-row-open-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #cbd5e1;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  cursor: pointer;
  opacity: 0.6;
  transition: all 0.1s;
}

.dsh-spotlight-item:hover .dsh-spotlight-row-open-btn,
.dsh-spotlight-item-selected .dsh-spotlight-row-open-btn {
  opacity: 1;
}

.dsh-spotlight-row-open-btn:hover {
  background: #2563eb !important;
  border-color: #3b82f6 !important;
  color: #ffffff !important;
}

/* 3. Bottom Preview Pane (IntelliJ style) */
.dsh-spotlight-preview-pane {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: #141517;
  max-height: 250px;
  display: flex;
  flex-direction: column;
}

.dsh-spotlight-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #1a1b1e;
  font-size: 12px;
}

.dsh-spotlight-preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.preview-session-name {
  color: #ffffff;
}

.preview-session-cwd {
  font-weight: 400;
  color: #94a3b8;
  font-size: 11px;
}

.dsh-spotlight-preview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 11px;
}

.preview-status-running {
  color: #34d399;
  font-weight: 600;
}

.dsh-spotlight-preview-body {
  padding: 10px 16px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  max-height: 200px;
}

.dsh-spotlight-preview-loading {
  padding: 24px;
  text-align: center;
  color: #94a3b8;
}

.dsh-spotlight-preview-msg-header {
  font-size: 11px;
  font-weight: 600;
  margin: 8px 0 3px 0;
  padding: 2px 6px;
  border-radius: 3px;
  width: fit-content;
}

.dsh-spotlight-preview-msg-header.user {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.12);
}

.dsh-spotlight-preview-msg-header.assistant {
  color: #34d399;
  background: rgba(52, 211, 153, 0.12);
}

.dsh-spotlight-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 2px 6px;
  border-radius: 3px;
}

.dsh-spotlight-line-matched {
  background: rgba(33, 66, 131, 0.5) !important;
  border-left: 2px solid #3b82f6;
}

.dsh-spotlight-line-num {
  color: #64748b;
  min-width: 24px;
  text-align: right;
  user-select: none;
  font-size: 11px;
}

.dsh-spotlight-line-content {
  color: #cbd5e1;
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-spotlight-session-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: inherit;
  font-size: 13px;
  padding: 8px 0;
}

.session-card-row strong {
  color: #94a3b8;
}

.session-card-row code {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}

/* 4. Footer */
.dsh-spotlight-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: #1e1f22;
  font-size: 11px;
  color: #94a3b8;
}

.dsh-spotlight-shortcuts {
  display: flex;
  align-items: center;
  gap: 6px;
}

.shortcut-key {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
  font-weight: 600;
  color: #cbd5e1;
}

/* High-contrast solid blue button (NEVER white-on-white) */
.dsh-spotlight-open-btn {
  background: #2563eb !important;
  color: #ffffff !important;
  border: 1px solid #3b82f6 !important;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
  transition: background 0.15s;
}

.dsh-spotlight-open-btn:hover {
  background: #1d4ed8 !important;
}

.dsh-spotlight-close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  padding: 6px 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.dsh-spotlight-close-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
}

@media (max-width: 768px) {
  .dsh-spotlight-overlay {
    padding-top: 0;
    align-items: stretch;
    background: rgba(0, 0, 0, 0.85);
  }

  .dsh-spotlight-dialog {
    width: 100vw;
    max-width: 100vw;
    height: 100%;
    max-height: 100dvh;
    max-height: 100vh;
    border-radius: 0;
    border: none;
    box-shadow: none;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .dsh-spotlight-header {
    padding: 10px 12px;
    gap: 8px;
    flex-wrap: wrap;
  }

  .dsh-spotlight-search-box {
    order: 1;
    flex: 1 1 auto;
    min-width: 0;
    padding: 8px 12px;
  }

  .dsh-spotlight-close-btn {
    order: 2;
    flex: 0 0 36px;
    width: 36px;
    height: 36px;
    padding: 0;
    font-size: 18px;
  }

  .dsh-spotlight-filters {
    order: 3;
    flex: 0 0 100%;
    width: 100%;
    display: flex;
    gap: 8px;
    margin-top: 2px;
  }

  .dsh-spotlight-filter-btn {
    flex: 1;
    justify-content: center;
    height: 36px;
    font-size: 13px;
  }

  .dsh-spotlight-input {
    font-size: 16px !important;
  }

  .dsh-spotlight-list {
    flex: 1;
    min-height: 0;
    max-height: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  .dsh-spotlight-item {
    padding: 12px 14px;
    min-height: 48px;
  }

  .dsh-spotlight-item-location {
    display: none;
  }

  .dsh-spotlight-row-open-btn {
    opacity: 1;
    padding: 4px 8px;
    font-size: 13px;
  }

  .dsh-spotlight-preview-pane {
    display: none !important;
  }

  .dsh-spotlight-footer {
    display: none !important;
  }
}

/* Intercepting sidebar search: keep search button visible, suppress inline input expand */
[class*="searchSlotExpanded"] {
  max-width: 28px !important;
}
[class*="searchInput"] {
  display: none !important;
}
`;

    return {
      inject: ['slots', 'sessions', 'uiWorkspace', 'layout'],
      apply(ctx) {
        // ponytail: client-side caching; upgrade to host-side hybrid FTS if history exceeds 10k messages

        // 1. Insert CSS styles
        if (typeof styles !== 'undefined' && styles.insert) {
          styles.insert(STYLES);
        } else if (typeof document !== 'undefined') {
          const styleEl = document.createElement('style');
          styleEl.id = 'dsh-spotlight-css';
          styleEl.textContent = STYLES;
          document.head.appendChild(styleEl);
        }

        // 2. Register modal in shell.overlay
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-spotlight-dialog',
          order: 999
        }, (slotProps) => h(SpotlightModal, { ...slotProps, ctx })));

        // 3. Intercept sidebar search button and global shortcut
        const isSearchTrigger = (target) => {
          if (!target || !(target instanceof Element)) return false;
          if (target.closest('.dsh-spotlight-dialog, .dsh-spotlight-overlay')) return false;
          return target.closest(
            'button[aria-label*="Search" i], button[aria-label*="Buscar" i], button[aria-label*="搜索"], [class*="searchButton"], button[aria-keyshortcuts*="K"]'
          );
        };

        const onCaptureClick = (e) => {
          if (isSearchTrigger(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('dsh:spotlight:open'));
          }
        };

        const onCaptureKeyDown = (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('dsh:spotlight:open'));
          }
        };

        if (typeof window !== 'undefined') {
          window.addEventListener('click', onCaptureClick, true);
          window.addEventListener('keydown', onCaptureKeyDown, true);
        }

        return () => {
          if (typeof window !== 'undefined') {
            window.removeEventListener('click', onCaptureClick, true);
            window.removeEventListener('keydown', onCaptureKeyDown, true);
          }
        };
      }
    };
  }
});
