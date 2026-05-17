# SERVER_API.md — Pyn TypeScript Client

**Production Cloudflare Worker:** `~/Documents/HELPERS/server-modular/`

Compact reference of ALL actions the server handles. Permission levels: `any` (public), `user` (any authenticated), `admin`, `developer` (superadmin), `unauthenticated` (explicit).

---

## handlers-base.js — Reference Directory (МОЛ)

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `base_clear` | any (IMPORT_SECRET) | — | `{ok,success}` | `import_*` | — |
| `base_bulk_insert` | any (IMPORT_SECRET) | `records[]` | `{ok,success,inserted}` | `records_empty`, `import_*` | — |
| `base_set_version` | any (IMPORT_SECRET) | `base_version, base_updated_at` | `{ok,success}` | `missing_fields` | — |
| `base_import_full` | any (IMPORT_SECRET) | `records[], base_version, base_updated_at` | `{ok,success,imported,r2_snapshot}` | `records_empty` | `base_changed` |
| `base_version` | user | — | `{ok,base:{version,updated_at,note}}` | `base_meta_not_found` | — |
| `base_download_url` | user | — | `{ok,data:{url,version,blob_key_b64,blob_nonce_b64}}` | `base_meta_not_found` | — |
| `base_download` | user | `limit?, offset?` | `{ok,count,total,data[],version,updated_at}` | — | — |
| `base_count` | any | — | `{ok,count}` | — | — |
| `base_sample` | any | `limit?` | `{ok,count,data[]}` | — | — |
| `base_find` | any | `query, limit?` | `{ok,count,data[]}` | `query_empty` | — |
| `rebroadcast_base` | admin | — | `{ok,success,sent,base_version}` | `base_meta_not_found` | `base_changed` |

---

## handlers-session.js — Auth & Session

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `login` | unauthenticated | `login, password, device_id, app_version, platform?, integrity_token?, desktop_os?, binary_sha?` | `{ok,success,token,expires_at,user:{id,login,full_name,role}}` | `user_not_found`, `wrong_password`, `user_inactive`, `integrity_required`, `app_version_too_old`, `binary_tampered`, `app_blocked` | `desktop_kicked` |
| `app_status` | unauthenticated | `app_scope?, app_version?, _authorization?` | `{ok,app_state,version_ok,min_version,current_version,base_version}` | — | — |
| `me` | user | — | `{ok,user:{id,login,role,avatar_url,presence_status},features:{}}` | `user_not_found` | — |
| `logout` | user | `push_token?, device_id?` | `{ok,success}` | — | — |
| `change_password` | user | `old_password, new_password` | `{ok,success}` | `wrong_old_password`, `new_password_too_short` | — |
| `heartbeat` | user | `device_id, app_state?` | `{ok,ts,app_state,base_version}` | — | — |
| `register_push_token` | user | `push_token, platform?, device_id?, app_version?` | `{ok,success}` | `push_token_empty` | — |
| `unregister_push_token` | user | `push_token` | `{ok,success}` | `push_token_empty` | — |
| `client_debug` | user | `event, payload?, ...flat` | `{ok}` | — | — |

---

## handlers-pc-session.js — Desktop QR/Password Login

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `request_pc_session_qr` | unauthenticated | — | `{ok,qr_token,qr_url}` | — | — |
| `check_pc_session_status` | unauthenticated | `qr_token` | `{ok,status,token?,expires_at?}` | — | — |
| `password_login_pc` | unauthenticated | `login, password, device_id` | `{ok,token,user:{login,role}}` | `user_not_found`, `wrong_password` | — |
| `get_password_counter` | unauthenticated | — | `{ok,counter}` | — | — |
| `redeem_qr_token` | user | `qr_token` | `{ok,success,message}` | — | — |
| `extend_session` | user | — | `{ok,expires_at}` | — | — |
| `list_pc_sessions` | user | — | `{ok,data:[{id,device_id,created_at,last_seen_at}]}` | — | — |
| `revoke_pc_session` | user | `session_id` | `{ok,success}` | — | — |
| `reset_password_login_counter` | user | — | `{ok,success}` | — | — |
| `me_session_info` | user | — | `{ok,session:{id,device_id,platform,expires_at,last_seen_at}}` | — | — |

---

## handlers-chat.js — Chat & Admin Messages

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `send_message` | user | `text, receiver_login?, attachments[], reply_to_id?, local_item_id?` | `{ok,success,id}` | `text_empty`, `receiver_not_found`, `receiver_inactive` | `new_message`, `unread_update` |
| `get_admin_messages` | admin | `limit?` | `{ok,count,data[]}` (per-sender dedup) | — | — |
| `get_user_chat` | user | `limit?` | `{ok,count,data[]}` | — | — |
| `get_admin_chat` | admin | `user_login, limit?` | `{ok,count,data[]}` | — | — |
| `mark_message_read` | user | `id` | `{ok,success}` | `message_not_found`, `forbidden_message_access` | `unread_update` |
| `get_unread_counts` | user | — | `{ok,data:{news,admin_messages}}` | — | — |
| `mute_contact` | admin | `target_login` | `{ok,success}` | `target_login_empty` | — |
| `unmute_contact` | admin | `target_login` | `{ok,success}` | `target_login_empty` | — |
| `get_muted_contacts` | admin | — | `{ok,data:[]}` | — | — |
| `set_dnd_schedule` | user | `dnd_start, dnd_end` | `{ok,success,dnd_start,dnd_end}` | `invalid_time_format`, `dnd_column_missing` | — |

---

## handlers-feed.js — News, Polls, Pinning

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `send_news` | admin | `text, attachments[], priority?` | `{ok,success,data:{message_id,priority}}` | `text_empty`, `role_forbidden` | `news_update` |
| `get_news` | user | `limit?` | `{ok,count,data[]}` (decorated, soft-delete filtered) | `role_forbidden` | — |
| `get_news_readers` | admin | `message_id` | `{ok,data:{news,count,read_users[],unread_users[]}}` | `message_id_empty`, `news_not_found` | — |
| `create_news_poll` | admin | `title, description, options[], attachments?` | `{ok,success,data:{message_id,poll_id}}` | `poll_payload_invalid`, `role_forbidden` | `news_update` |
| `vote_news_poll` | user | `poll_id, option_ids[]` (single-choice, takes [0]) | `{ok,success}` | `vote_payload_invalid`, `poll_not_found`, `already_voted` | `news_update` |
| `get_poll_stats` | admin | `poll_id` | `{ok,data:{poll,total_voters,options[],voters[],non_voters[]}}` | `poll_id_empty`, `poll_not_found` | — |
| `edit_message` | author\|admin | `id, text` | `{ok,success,id,text}` | `id_empty`, `message_not_found`, `edit_window_expired` | `news_update`/`new_message` |
| `soft_delete_message` | author\|admin | `id` | `{ok,success,id}` | `id_empty`, `message_not_found`, `forbidden` | `news_update` |
| `undelete_message` | author\|admin | `id` | `{ok,success,id}` | `id_empty`, `message_not_found`, `not_deleted` | `news_update` |
| `pin_message` | admin | `message_id` | `{ok,success}` | `message_id_empty`, `already_pinned`, `pin_limit_reached` | `news_update` |
| `unpin_message` | admin | `message_id` | `{ok,success}` | `message_id_empty` | `news_update` |

---

## handlers-reactions.js — Message Reactions

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `add_reaction` | user | `message_id, emoji` | `{ok,success}` | `message_id_empty`, `invalid_emoji` | `news_update`, `new_message` |
| `remove_reaction` | user | `message_id, emoji` | `{ok,success}` | `id_or_emoji_empty` | `news_update`, `new_message` |
| `get_reactions` | user | `message_id` | `{ok,data:{aggregate:{emoji→count},voters:{emoji→[{user_login,full_name,created_at}]}}}` | `message_id_empty` | — |

---

## handlers-admin.js — User Management & System

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `create_user` | admin | `new_login, full_name, password?, role, must_change_password?` | `{ok,success,data:{login,full_name,role,is_active}}` | `create_user_payload_invalid`, `invalid_role`, `login_already_exists` | — |
| `get_users` | admin | — | `{ok,count,data:[{login,full_name,role,avatar_url,presence_status,last_seen_at}]}` | — | — |
| `reset_password` | developer | `target_login, new_password?` | `{ok,success,sessions_revoked}` | `target_login_empty`, `user_not_found` | — |
| `toggle_user` | developer | `target_login` | `{ok,success,is_active,is_suspended}` | `target_login_empty`, `user_not_found` | — |
| `rename_user` | developer | `target_login, full_name` | `{ok,success,login,full_name}` | `target_login_empty`, `full_name_empty`, `user_not_found` | — |
| `change_login` | developer | `target_login, new_login` | `{ok,success,old_login,login}` | `target_login_empty`, `new_login_empty`, `user_not_found`, `login_already_exists` | — |
| `change_role` | developer | `target_login, new_role` | `{ok,success,login,role}` | `target_login_empty`, `invalid_role`, `user_not_found` | — |
| `delete_user` | developer | `target_login` | `{ok,success,login}` | `target_login_empty`, `cannot_delete_self`, `user_not_found` | — |
| `get_app_version` | admin | `app_scope?` | `{ok,data:{app_scope,min_version,current_version,...}}` | — | — |
| `set_app_version` | developer | `app_scope?, min_version, current_version, update_url?, force_update?, notes?, apk_sha256?, binary_sha?` | `{ok,success}` | `missing_fields` | push broadcast |
| `broadcast_app_version` | any (RELEASE_SECRET) | `release_secret, app_scope?` | `{ok,success,current_version}` | `release_secret_invalid`, `app_version_not_found` | push broadcast |
| `rebroadcast_base` | admin | — | `{ok,success,sent,base_version}` | `base_meta_not_found`, `push_dispatch_failed` | `base_changed` |
| `get_system_state` | user | `app_scope?` | `{ok,data:{app_scope,state,title,message,...}}` | — | — |
| `set_app_pause` | developer | `app_scope?, state?, title?, message?, require_confirmation?, auto_wipe_after_hours?` | `{ok,success}` | — | — |
| `clear_app_pause` | developer | `app_scope?` | `{ok,success}` | — | — |
| `get_presence_snapshot` | admin | `logins[]?` | `{ok,data:[{login,status,last_seen_at}]}` | — | — |
| `get_audit_log` | developer | `actor_login?, action_filter?, target_type?, from_date?, to_date?, limit?, offset?` | `{ok,total,count,data[],actors:[]}` | — | — |
| `get_app_stats` | developer | `since_days?` | `{ok,data:{total_users,total_messages,active_users[],top_events[]}}` | — | — |
| `get_app_errors` | developer | `since_days?, limit?` | `{ok,data:{since_days,errors:[]}}` | — | — |
| `delete_message` | developer | `message_id` | `{ok,success,message_id}` | `message_id_empty`, `message_not_found` | — |

---

## handlers-media.js — Avatars & Attachments

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `set_avatar` | user | `data_url` OR `data_base64`, mime_type?, file_name?` | `{ok,avatar_url,storage_key,avatar_blob_key_b64,avatar_blob_nonce_b64}` | `avatar_payload_empty`, `avatar_too_large` (>500KB), `avatar_animated_not_allowed` | — |

**GET endpoints (public):**
- `/avatar/{login}` → encrypted avatar bytes from R2 (cache on CF edge)
- `/a/{public_id}` → opaque lookup, same
- `/media/{storage_key}` → encrypted attachment bytes from R2

---

## handlers-drafts.js — Drafts & Scheduled Messages

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `save_draft` | user | `scope, text` | `{ok,success}` | `scope_empty`, `drafts_save_failed` | — |
| `load_draft` | user | `scope` | `{ok,data:{text,updated_at}}` | `scope_empty` | — |
| `list_drafts` | user | — | `{ok,data:[{scope,text,updated_at}]}` | — | — |
| `schedule_message` | admin | `kind (news\|poll), payload (JSON), send_at (ISO)` | `{ok,success,data:{id,send_at}}` | `invalid_kind`, `payload_empty`, `send_at_not_in_future` | — |
| `list_scheduled` | admin | — | `{ok,data:[{id,kind,payload,send_at,status,sent_at,cancelled_at}]}` | — | — |
| `cancel_scheduled` | admin | `id` | `{ok,success}` | `id_empty`, `not_found`, `not_cancellable`, `forbidden` | — |

**Cron:** `runScheduledCron()` (every minute) — promotes pending→sent in app_messages, broadcasts `news_update`

---

## handlers-sheets.js — Google Sheets Bridge (Desktop)

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `list_sheets` | admin | — | `{ok,data:[{id,name,url}]}` | — | — |
| `get_sheet` | admin | `sheet_id, range?` | `{ok,data:{id,name,values[]}}` | `sheet_id_empty` | — |
| `update_cell` | admin | `sheet_id, range, values[]` | `{ok,success}` | `sheet_id_empty`, `update_failed` | — |
| `run_script` | admin | `script_name, params?` | `{ok,data:{result}}` | `script_name_empty`, `execution_failed` | — |
| `get_client_config` | admin | — | `{ok,data:{google_api_key,...}}` | — | — |
| `search_sap_doc` | admin | `query` | `{ok,count,data[]}` | `query_empty` | — |
| `check_sheet_action_status` | admin | `action_id` | `{ok,data:{status,result?}}` | `action_id_empty` | — |

---

## handlers-macro.js — Server-Orchestrated Macros (Desktop)

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `get_macro_bundle` | user | `macro_name` | `{ok,data:{macro_token,bundle}}` | `macro_name_empty` | — |
| `submit_macro_data` | any (macro_token) | `macro_token, payload` | `{ok,success}` | `macro_token_invalid`, `payload_empty` | — |

**Note:** `submit_macro_data` uses one-time `macro_token` (15 min TTL) instead of session, so works even if session expires during long macro execution.

---

## handlers-telemetry.js — Client Telemetry

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `log_errors` | user | `errors[{error_class,error_message,device_model,os_version,app_version}]` | `{ok}` | — | — |
| `log_activity` | user | `event_type, event_data?` | `{ok}` | — | — |

---

## handlers-metrics.js — Network Observability

| Action | Permission | Request | Response | Errors | WS Event |
|--------|-----------|---------|----------|--------|----------|
| `log_metrics` | user | `batch[{endpoint,method,status,duration_ms,timestamp}]` | `{ok,success}` | — | — |
| `get_network_stats` | admin | `since_minutes?, limit?` | `{ok,data:{endpoints:[],by_status:{}}}` | — | — |

---

## Missing from @pyn/core/endpoints

**Implemented on server but NO TypeScript wrapper in Pyn client:**

### Base reference (handlers-base.js)
- `base_clear`, `base_bulk_insert`, `base_set_version`, `base_import_full` (import HMAC)
- `base_download`, `base_count`, `base_sample`, `base_find` (all client-side search)
- `rebroadcast_base` (admin kill-switch)

### Session (handlers-session.js)
- `heartbeat` (presence + base_version check)
- `client_debug` (silent client logging)

### PC-session desktop QR/password (handlers-pc-session.js)
- `request_pc_session_qr`, `check_pc_session_status` (QR login)
- `password_login_pc`, `get_password_counter`, `reset_password_login_counter` (password login)
- `redeem_qr_token`, `extend_session`, `list_pc_sessions`, `revoke_pc_session`, `me_session_info`

### Chat (handlers-chat.js)
- `mute_contact`, `unmute_contact`, `get_muted_contacts` (per-conversation mute)
- `set_dnd_schedule` (Do Not Disturb)

### Feed (handlers-feed.js)
- `get_news_readers` (admin stat)
- `get_poll_stats` (admin stat)
- `edit_message`, `soft_delete_message`, `undelete_message` (Phase 12a)

### Reactions (handlers-reactions.js)
- `get_reactions` (aggregate + voters)

### Media (handlers-media.js)
- `set_avatar` (but GET /avatar/{login} is public)

### Drafts & Scheduled (handlers-drafts.js)
- `load_draft`, `list_drafts` (but NOT save_draft)
- `schedule_message`, `list_scheduled`, `cancel_scheduled`

### Admin user management (handlers-admin.js)
- `create_user`, `reset_password`, `toggle_user`, `rename_user`, `change_login`, `change_role`, `delete_user`
- `get_system_state`, `set_app_pause`, `clear_app_pause`
- `get_presence_snapshot`
- `get_audit_log`, `get_app_stats`, `get_app_errors`
- `delete_message` (superadmin)

### Sheets bridge (handlers-sheets.js)
- All 7 actions (desktop-only, admin-gated)

### Macros (handlers-macro.js)
- `get_macro_bundle`, `submit_macro_data` (token-based, not session)

### Telemetry (handlers-telemetry.js)
- `log_errors`, `log_activity`

### Metrics (handlers-metrics.js)
- `log_metrics`, `get_network_stats`

---

**Summary:**
- **Total server actions:** 82
- **Wrapped in @pyn/core/endpoints:** 14
  - auth.ts: 6 (login, me, appStatus, getPasswordCounter, requestPcSessionQr, checkPcSessionStatus)
  - news.ts: 5 (getNews, sendNews, voteNewsPoll, pinMessage, unpinMessage, softDeleteMessage) — softDeleteMessage is wrapped in 4 unique endpoints
  - chats.ts: 3 (getAdminMessages, getAdminChat, sendMessage, markMessageRead)
  - reactions.ts: 2 (addReaction, removeReaction)
- **Missing:** 68 actions (desktop features, admin/dev tools, telemetry, sheets integration, scheduled messages, drafts, DND, mute, audit log, presence, app stats)
