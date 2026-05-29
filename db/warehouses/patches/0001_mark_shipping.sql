-- Patch 0001: Помечаем 16 складов как is_shipping=1.
-- Источник: Pyn INITIAL_SCHEDULE.shippingWarehouses (все 16 — УПП, центральные).
-- Idempotent — повторный run не вредит.
--
-- Применять можно поверх seed.sql v1 (где is_shipping везде 0), либо
-- если хочешь обновить production без полного re-seed'а.
-- No BEGIN/COMMIT wrapper: `wrangler d1 execute --remote` rejects transaction keywords (UPDATE … WHERE id IN (…) is idempotent).

UPDATE warehouses SET is_shipping = 1 WHERE id IN (
  '824Ц',
  '9002', '9003', '9006', '9010', '9012', '9013', '9023',
  '9030', '9036', '9044', '9050', '9051', '9054', '9113', '9508'
);

-- Verify (опционально):
-- SELECT id, shop_name, designation FROM warehouses WHERE is_shipping = 1;
