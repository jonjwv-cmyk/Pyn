-- Seed: 534 warehouse records from wf_warehouses xlsx (2026-05).
-- 16 warehouses marked is_shipping=1 from Pyn INITIAL_SCHEDULE.shippingWarehouses.
-- Run AFTER schema.sql. Idempotent via INSERT OR REPLACE.
-- No BEGIN/COMMIT wrapper: `wrangler d1 execute --remote` rejects transaction keywords (INSERT OR REPLACE is idempotent, safe to re-apply).

INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2800', 'АВТОТРАНСПОРТНОЕ УПРАВЛЕНИЕ', '128', 'Промежуточный склад', 'АТЦ ГСМ транз.', 'АТЦ ГСМ', NULL, '028', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2801', 'АВТОТРАНСПОРТНОЕ УПРАВЛЕНИЕ', '128', 'Промежуточный склад', 'КБК', 'АТЦ НОВЫЕ З/ЧАС.', NULL, '028А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2803', 'АВТОТРАНСПОРТНОЕ УПРАВЛЕНИЕ', '128', 'Склад МОЛ', 'АТЦ СпОд и ВспМ', 'АТЦ СПОД И ВСПМ', '49  71  95', '028Д', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2807', 'АВТОТРАНСПОРТНОЕ УПРАВЛЕНИЕ', '128', 'Склад МОЛ', 'ЗИП', 'АТЦ ЗИП', NULL, '0282807', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2601', 'ГАЗОСПАСАТЕЛЬНАЯ СТАНЦИЯ', '026', 'Склад МОЛ', 'МПЗ ГСС', 'МПЗ ГСС', '49  10  89', '026А', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2301', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.РБЦ з/ч б/у', 'ДИТ.РБЦ З/Ч Б/У', NULL, '037F', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2302', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.ДП з/ч б/у', 'ДИТ.ДП З/Ч Б/У', NULL, '123G', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2303', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.МВО з/ч б/у', 'ДИТ.МВО З/Ч Б/У', NULL, '123L', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2305', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.ДП з/ч б/у', 'ДИТ.ДП З/Ч Б/У', NULL, '123O', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2306', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.РБЦ з/ч б/у', 'ДИТ.РБЦ З/Ч Б/У', NULL, '123R', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2307', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.МНЛЗ з/ч б/у', 'ДИТ.МНЛЗ З/Ч Б/У', NULL, '123S', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2308', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.КХП з/ч б/у', 'ДИТ.КХП З/Ч Б/У', NULL, '123V', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2309', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.КОиВОСз/ч бу', 'ДИТ.КОИВОСЗ/Ч БУ', NULL, '123Z', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2311', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'Склад ДИТ', 'СКЛАД ДИТ', '49  03  84', '123Б', 'ВЫЕЗД', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2312', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ МПЗ,с/од,СИЗ', 'ДИТ МПЗ,С/ОД,СИЗ', '49  63  36
49  65  71
49  81  86', '123В', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2313', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ПТД', 'ПТД', '49  03  84', '123Г', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2314', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.КБЦ з/ч б/у', 'ДИТ.КБЦ З/Ч Б/У', NULL, '123Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2316', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.ЦПШБ з/ч б/у', 'ДИТ.ЦПШБ З/Ч Б/У', NULL, '123Л', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2318', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ. КБЦ з/ч б/у', 'ДИТ.КБЦ З/Ч Б/У', NULL, '123Т', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2321', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.КБЦ з/ч б/у', 'ДИТ.КБЦ З/Ч Б/У', NULL, '037H', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2322', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.ЦПШБ з/ч б/у', 'ДИТ.ЦПШБ З/Ч Б/У', NULL, '037V', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2323', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.ЦПШБ з/ч б/', 'ДИТ.ЦПШБ З/Ч Б/', NULL, '037W', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2324', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.ККП з/ч б/у', 'ДИТ.ККП З/Ч Б/У', NULL, '037Z', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2325', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.РБЦ з/ч б/у', 'ДИТ.РБЦ З/Ч Б/У', NULL, '123D', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2326', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.РБЦ з/ч б/у', 'ДИТ.РБЦ З/Ч Б/У', NULL, '123Q', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2327', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.РБЦ з/ч б/у', 'ДИТ.РБЦ З/Ч Б/У', NULL, '123U', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2329', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ. СП з/ч б/у', 'ДИТ. СП З/Ч Б/У', NULL, '123Щ', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2330', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Промежуточный склад', 'КБК', 'ДИТ КБК', NULL, '1232330', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2331', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.КХП з/ч б/у', 'ДИТ.КХП З/Ч Б/У', NULL, '1232331', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2332', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ.ТЭЦ з/ч б/у', 'ДИТ.ТЭЦ З/Ч Б/У', NULL, '037T', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2333', 'ДИРЕКЦИЯ ПО ИНФОРМАЦИОННЫМ ТЕХНОЛОГИЯМ', '123', 'Склад МОЛ', 'ДИТ АСУ ТП', 'ДИТ АСУ ТП ПРОКАТ, З/Ч, ВСП.МАТ', NULL, '1232333', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1810', 'ДИРЕКЦИЯ ПО КОНТРОЛЮ ЗА ИСПОЛН. БП И СА', '183', 'Промежуточный склад', 'СБ мбп,всп.м', 'СБ МБП,ВСП.М', NULL, '181А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1811', 'ДИРЕКЦИЯ ПО КОНТРОЛЮ ЗА ИСПОЛН. БП И СА', '183', 'Промежуточный склад', 'КБК', 'СБ КБК', NULL, '1831811', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0100', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'Доменный цех', 'ДОМЕННЫЙ ЦЕХ', '49  85  91', '001', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0101', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'п/ф', 'П/Ф', '49  77  03
49  85  84', '001Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0103', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'ДЦогнеуп', 'ДЦОГНЕУП', NULL, '001Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0104', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'ДЦсырье', 'ДЦСЫРЬЕ', '49  15  34
49  64  09', '001Д', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0105', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'Г/п, оседание', 'Г/П, ОСЕДАНИЕ', '49  15  34
49  77  03
49  77  08
49  85  84', '001Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0106', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'Скл.переработки', 'СКЛ.ПЕРЕРАБОТКИ', '49  15  34
49  77  08', '001Ж', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0107', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'ДЦ МПЗ уч.загруз', 'ДЦ МПЗ УЧ.ЗАГРУЗ', '49  15  34
49  77  08', '001З', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0108', 'ДОМЕННЫЙ ЦЕХ', '001', 'Промежуточный склад', 'КБК', 'КБК', NULL, '0010108', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0114', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'ДЦ МПЗ уч.ПУТ', 'ДЦ МПЗ УЧ.ПУТ', '49  64  09', '001П', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0116', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'ДЦ МПЗ разл.СХЧ', 'ДЦ МПЗ РАЗЛ.СХЧ', NULL, '001С', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0119', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'ДЦ МПЗуч ДП5,ДП6', 'ДЦ МПЗУЧ ДП5,ДП6', '49  77  03
49  85  84', '001Ш', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0122', 'ДОМЕННЫЙ ЦЕХ', '001', 'Склад МОЛ', 'ДЦ Аспирация', 'ДЦ АСПИРАЦИЯ', NULL, '0010122', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('825Т', 'ДОМЕННЫЙ ЦЕХ', '001', 'Центральный склад СП', 'Куст.ДЦ', 'КУСТОВОЙ ДЦ', NULL, '825Т', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3801', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Склад МОЛ', 'ККП', 'ККП', '49  81  76', '038А', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3802', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', NULL, '038Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3803', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Склад МОЛ', 'п/ф', 'П/Ф', NULL, '038В', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3804', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Склад МОЛ', 'ОРВ', 'ОРВ', NULL, '038Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3805', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Склад МОЛ', 'ОК', 'ОК', NULL, '038Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3814', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Склад МОЛ', 'ККЦвсп,зч.ГСМ ГО', 'ККЦВСП,ЗЧ.ГСМ ГО', '49  12  38
49  63  11
49  81  76', '043А', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3815', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Промежуточный склад', 'ККЦ ИМ', 'ККЦ ИМ', NULL, '3815', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3816', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Промежуточный склад', 'КБК', 'ККЦ КБК', NULL, '3803816', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3817', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Промежуточный склад', 'КГП,ГЦ ИнМагазин', 'ККЦ КГП, ГЦ ИНТЕРНЕТ МАГАЗИН', '49  81  76', '3803817', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3820', 'КИСЛОРОДНО-ГАЗОВОЕ ПРОИЗВОДСТВО', '038', 'Склад МОЛ', 'КГП КЦ (об.тара)', 'КГП КЦ (ОБОРОТНАЯ ТАРА)', NULL, '0063820', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8201', 'КОКСОВЫЙ ЦЕХ №3 КХП', '082', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', '49  03  94', '068Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8204', 'КОКСОВЫЙ ЦЕХ №3 КХП', '082', 'Склад МОЛ', 'МПЗ тех уч.5,6', 'МПЗ ТЕХ УЧ.5,6', '49  03  94
49  17  24', '068Т', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8206', 'КОКСОВЫЙ ЦЕХ №3 КХП', '082', 'Склад МОЛ', 'Коксовый цех3', 'КОКСОВЫЙ ЦЕХ3', NULL, '082', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8207', 'КОКСОВЫЙ ЦЕХ №3 КХП', '082', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', '49  03  94', '082Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8210', 'КОКСОВЫЙ ЦЕХ №3 КХП', '082', 'Склад МОЛ', 'МПЗ тех уч.9,10', 'МПЗ ТЕХ УЧ.9,10', '49  07  83
49  14  88', '082Т', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0900', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Склад ППУ БС', 'СКЛАД ППУ БС', '49  69  66
49  83  29', '009', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0901', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'НЗП БС', 'НЗП БС', '49  63  68', '0110901', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0902', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'п/ф', 'П/Ф', '49  68  90', '009Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0903', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', '49  68  29', '009В', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0904', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Скл.т/пролета БС', 'СКЛ.Т/ПРОЛЕТА БС', '49  63  68', '009Г', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0905', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Скл.реквизита БС', 'СКЛ.РЕКВИЗИТА БС', '49  68  29', '009Д', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0906', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Ск.м.лома ГХП БС', 'СК.М.ЛОМА ГХП БС', '49  63  68', '009Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0907', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Ск.м.лома т/п БС', 'СК.М.ЛОМА Т/П БС', '49  63  68', '009Ж', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0908', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Ск.м.лома ППУ БС', 'СК.М.ЛОМА ППУ БС', '49  69  66', '009З', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1000', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Уч.отд.мет-лаКПС', 'УЧ.ОТД.МЕТ-ЛАКПС', NULL, '010', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1001', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', '49  68  29', '010А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1002', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'п/ф', 'П/Ф', '49  68  95', '010Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1003', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Склад УПОК КПС', 'СКЛАД УПОК КПС', NULL, '010В', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1004', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Скл.УНУи ТОК КПС', 'СКЛ.УНУИ ТОК КПС', '49  63  68', '010Г', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1005', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Скл.реквизитаКПС', 'СКЛ.РЕКВИЗИТАКПС', '49  68  29', '010Д', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1006', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Склад ППЛ КПС', 'СКЛАД ППЛ КПС', '49  68  95', '010Е', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1007', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Ск.м.лома заг.уч', 'СК.М.ЛОМА ЗАГ.УЧ', '49  68  95', '010Ж', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1008', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Склад м.лома УГП', 'СКЛАД М.ЛОМА УГП', '49  87  98', '010З', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1010', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Пролет Г-Д 52-54', 'ПРОЛЕТ Г-Д 52-54', '49  87  98', '010Я', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1011', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'НЗП КПС', 'НЗП КПС', NULL, '0111011', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1013', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'КПС ППЛ ИД б/у', 'СКЛАД КПС ППЛ ИД Б/У', '49  68  95', '0111013', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1123', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Скл.мет-лома КБЦ', 'СКЛ.МЕТ-ЛОМА КБЦ', NULL, '011А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1124', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'п/ф', 'П/Ф', '49  68  90
49  68  95', '011Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1125', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Скл.инстр-та КБЦ', 'СКЛ.ИНСТР-ТА КБЦ', '49  68  90
49  68  95', '011Г', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1126', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Склад кровли КБЦ', 'СКЛАД КРОВЛИ КБЦ', '49  61  80', '011Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1135', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'УРПСО Аллегро', 'КБЦ УРПСО АЛЛЕГРО', NULL, '0111135', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1137', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Склад МОЛ', 'Строит-во ЛВК-3', 'СТРОИТЕЛЬСТВО ЛВК-3', NULL, '0111137', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('824Т', 'КОЛЁСОБАНДАЖНЫЙ ЦЕХ', '011', 'Центральный склад СП', 'Куст.КБЦ', 'КУСТОВОЙ КБЦ', NULL, '824Т', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0600', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'Конвертерный', 'КОНВЕРТЕРНЫЙ', '49  67  32', '006', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0603', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'Шлаковый двор №3', 'ШЛАКОВЫЙ ДВОР №3', NULL, '006W', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0605', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ уч.шиб.затв.', 'МПЗ УЧ.ШИБ.ЗАТВ.', '49  60  92
49  60  93', '006Б', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0606', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ уч.стальковш', 'МПЗ УЧ.СТАЛЬКОВШ', '49  67  60', '006В', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0608', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'Скл.ванад.прод-и', 'СКЛ.ВАНАД.ПРОД-И', '49  13  08', '006Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0609', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'КЦсырье(ШД-КО)', 'КЦСЫРЬЕ(ШД-КО)', '49  07  00
49  67  71
49  68  78
49  80  67
49  87  67', '006Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0611', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'п/ф', 'П/Ф', '49  67  71
49  68  09', '006З', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0612', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', '49  13  08', '006И', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0613', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'п/ф', 'П/Ф', NULL, '006К', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0614', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'КЦсырье-ВОС', 'КЦСЫРЬЕ-ВОС', '49  02  10
49  15  91', '006Л', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0615', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'Склад м/лома КЦ', 'СКЛАД М/ЛОМА КЦ', '49  19  46
49  67  71
49  69  42', '006М', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0616', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ МНЛЗ №1-4', 'МПЗ МНЛЗ №1-4', NULL, '006Н', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0617', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ конв.отдел.', 'МПЗ КОНВ.ОТДЕЛ.', '49  07  00
49  67  71
49  68  78', '006О', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0618', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ уч.промковш', 'МПЗ УЧ.ПРОМКОВШ', '49  19  46
49  65  59
49  69  42', '006П', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0620', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'Склад слитков', 'СКЛАД СЛИТКОВ', NULL, '006С', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0621', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ уч.печь-ковш', 'МПЗ УЧ.ПЕЧЬ-КОВШ', '49  02  10
49  15  91', '006Т', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0622', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ уч.вакуумат.', 'МПЗ УЧ.ВАКУУМАТ.', '49  19  46
49  69  42', '006У', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0626', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Промежуточный склад', 'КЦ г/п,перер.тр.', 'Г/П, ПЕРЕРАБОТКИ', NULL, '006Ч', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0627', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'МПЗ миксер,ших.д', 'МПЗ МИКСЕР,ШИХ.Д', '49  13  08
49  68  09
49  80  67', '006Ш', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0632', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'Cырье уч.ШОС', 'СЫРЬЕ УЧ.ШОС', '49  04  02
49  08  92', '00632', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0633', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'Гот.смеси уч.ШОС', 'ГОТОВЫЕ СМЕСИ УЧ.ШОС', '49  04  02
49  08  92', '00633', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0636', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Склад МОЛ', 'КЦ сырье КО', 'КЦ СЫРЬЕ КО', NULL, '0060636', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0637', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Промежуточный склад', 'ГП ЧМЗ', 'ГП ЧМЗ', NULL, '637', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('806Т', 'КОНВЕРТЕРНЫЙ ЦЕХ №1', '006', 'Центральный склад СП', 'Куст.КЦ', 'КУСТОВОЙ КЦ', NULL, '806Т', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1400', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - КСС', 'КСЦ КСС', '49  66  16', '014', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1401', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - ТМО КСС', 'КСЦ ТМО КСС', '49  18  64
49  64  91', '014А', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1402', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - СГП МУ КСС', 'КСЦ СГП МУ КСС', '49  11  62', '014Б', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1404', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ-МетотходыКСС', 'КСЦ МЕТОТХОДЫКСС', '49  64  92
49  69  74', '014Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1405', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - УПСО', 'КСЦ УПСО', '49  69  74', '014Д', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1406', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - Отделка', 'КСЦ ОТДЕЛКА', '49  64  92', '014Е', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1408', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - ГП ШПС УПП', 'КСЦ ГП ШПС УПП', '49  05  36
49  81  19', '014З', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1409', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ-ОгнеупорыКСС', 'КСЦ ОГНЕУПОРЫКСС', '49  16  20', '014И', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1410', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ-НЗП, п/ф КСС', 'КСЦ НЗП, П/Ф КСС', '49  11  62
49  16  20', '014К', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1411', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'ГП,оседание, п/ф', 'КСЦ ГП,ОСЕДАНИЕ, П/Ф', '49  11  62', '014Л', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1414', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ-ОгнеупорыШПЦ', 'КСЦ ОГНЕУПОРЫШПЦ', '49  07  79
49  16  20', '014О', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1415', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - ТМО ШПС', 'КСЦ ТМО ШПС', NULL, '014П', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1416', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ - СГП МУ ШПС', 'КСЦ СГП МУ ШПС', '49  15  39
49  85  77', '014Р', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1417', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'ГП,оседание, п/ф', 'КСЦ ШПС ГП,ОСЕДАНИЕ,П/Ф', '49  15  39
49  85  77', '014С', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1418', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ всп.BR,СГПBR', 'КСЦ ВСП.BR,СГПBR', '49  11  62', '014Т', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1419', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'КСЦ-МетотходыШПС', 'КСЦ МЕТОТХОДЫ ШПС', '49  85  77', '014У', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1427', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'ГП в пути', 'КСЦ ГП В ПУТИ', NULL, '014Ю', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1428', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Склад МОЛ', 'ГП на о/хранении', 'КСЦ ГП НА О/ХРАНЕНИИ', NULL, '014Я', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1429', 'КРУПНОСОРТНЫЙ ЦЕХ', '016', 'Склад МОЛ', 'ГП в пути', 'ГП В ПУТИ', NULL, '01429', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1430', 'КРУПНОСОРТНЫЙ ЦЕХ', '016', 'Склад МОЛ', 'ГП на о/хранении', 'ГП НА О/ХРАНЕНИИ', NULL, '01430', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1431', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Промежуточный склад', 'КСЦ Маркеплейс', 'КСЦ МАРКЕПЛЕЙС', '49  18  64
49  64  91', '01431', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1432', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Промежуточный склад', 'КБК', 'КСЦ КБК', NULL, '0141432', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('823Т', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Центральный склад СП', 'Куст.КСЦ', 'КУСТОВОЙ КСЦ', NULL, '823Т', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9920', 'КРУПНОСОРТНЫЙ ЦЕХ', '014', 'Промежуточный склад', 'ТП РПМ КСЦ', 'ТП РПМ КСЦ', NULL, '9920', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('OTKZ', 'КУСТОВЫЕ СКЛАДЫ НТМК', '00K', 'Центральный склад', 'ВиртСклОтказПотр', 'ВИРТСКЛОТКАЗПОТР', NULL, 'ОТКЗ', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T103', 'КУСТОВЫЕ СКЛАДЫ НТМК', '00K', 'Промежуточный склад', 'транзит-топливо', 'ТРАНЗИТ-ТОПЛИВО', NULL, 'Т103', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T652', 'КУСТОВЫЕ СКЛАДЫ НТМК', '00K', 'Промежуточный склад', 'Транзитный склад', 'ТРАНЗИТНЫЙ СКЛАД', NULL, '6520', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('USL6', 'КУСТОВЫЕ СКЛАДЫ НТМК', '00K', 'Промежуточный склад', 'Угар,потери жел.', 'УГАР,ПОТЕРИ ЖЕЛ.', NULL, 'УСЛ6', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('USL7', 'КУСТОВЫЕ СКЛАДЫ НТМК', '00K', 'Промежуточный склад', 'Угар,потери', 'УГАР,ПОТЕРИ', NULL, 'УСЛ7', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5401', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3лом,отходы', 'ЦРМО3ЛОМ,ОТХОДЫ', '49  70  57', '354А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5402', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 инструмент', 'ЦРМО3 ИНСТРУМЕНТ', NULL, '354Б', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5405', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3скл.металла', 'ЦРМО3СКЛ.МЕТАЛЛА', NULL, '354Д', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5406', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 соб.изг.', 'ЦРМО3 СОБ.ИЗГ.', '49  70  57', '354Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5407', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3п/ф внут.об', 'ЦРМО3 П/Ф ВНУТР.ОБОРОТА', NULL, '354Ж', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5408', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 НЗП мех.уч', 'ЦРМО3 НЗП МЕХ.УЧ', NULL, '354З', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5409', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'М-лы в переработ', 'М-ЛЫ В ПЕРЕРАБОТ', '49  70  57', '354И', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5410', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 уч.ПСО', 'ЦРМО3 УЧ.ПСО', '49  67  33
49  82  33', '354К', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5411', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 ролики б/у', 'ЦРМО3 РОЛИКИ Б/У', NULL, '354Л', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5412', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 п/ф цехам', 'ЦРМО3 П/Ф ЦЕХАМ', NULL, '354М', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5413', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 НЗП уч.м.к', 'ЦРМО3 НЗП УЧ.М.К', NULL, '354Н', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5414', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 НЗП т/обр.', 'ЦРМО3 НЗП Т/ОБР.', '49  67  33
49  82  33', '354О', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5415', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 НЗП сборка', 'ЦРМО3 НЗП СБОРКА', NULL, '354П', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5416', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 м-лы напл.', 'ЦРМО3 М-ЛЫ НАПЛ.', '49  67  33
49  82  33', '354Р', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5417', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3 НЗП МНЛЗ', 'ЦРМО3 НЗП МНЛЗ', NULL, '354С', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5418', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Промежуточный склад', 'ЦРМО3 транз.усл.', 'ЦРМО3 ТРАНЗ.УСЛ.', NULL, '354Т', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5419', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3Кран.колеса', 'ЦРМО3КРАН.КОЛЕСА', NULL, '354У', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5420', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'ЦРМО3п/ф в пр-во', 'ЦРМО3 П/Ф В ПР-ВО', NULL, '35420', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5421', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Промежуточный склад', 'КБК', 'ЦРМО3 КБК', NULL, '3545421', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8022', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Центральный склад СП', 'ЦРМО-3 МПЗ', 'ЦРМО-3 МПЗ', '49  68  13', '8022', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8603', 'МЕХАНИЧЕСКИЙ ЦЕХ', '360', 'Склад МОЛ', 'Склад МПЗ', 'СКЛАД МПЗ', '49  05  81
49  73  53
49  85  17', '086У', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1821', 'НАУЧНО-ИССЛЕДОВАТЕЛЬСКИЙ ЦЕНТР', '182', 'Склад МОЛ', 'НИЦ исл.лаб.', 'ИССЛЕДОВАТЕЛЬСКАЯ ЛАБОРАТОРИЯ', '49  64  55', '1821821', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1822', 'НАУЧНО-ИССЛЕДОВАТЕЛЬСКИЙ ЦЕНТР', '182', 'Склад МОЛ', 'НИЦ Лаб.мет.исп.', 'НИЦ ЛАБ.МЕТ.ИСП.', '49  17  21', '1821822', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1823', 'НАУЧНО-ИССЛЕДОВАТЕЛЬСКИЙ ЦЕНТР', '182', 'Промежуточный склад', 'КБК НИЦ', 'КБК НИЦ', NULL, '1821823', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1880', 'ОТДЕЛ ПО РАЗВИТИЮ ТЕХНИЧ. ОБСЛ.И РЕМОНТА', '188', 'Промежуточный склад', 'КБК ОР ТОиР', 'КБК ОР ТОИР', NULL, '1880', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('OTRZ', 'ОТРИЦ. ЗАПАС', 'OTR', 'ТехУчет Новый', 'Склад отр.запаса', 'НТМК', NULL, '1000', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1300', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦмет-лом', 'РБЦМЕТ-ЛОМ', '49  05  92', '013', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1301', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'вспом.материалы', 'ВСПОМ.МАТЕРИАЛЫ', '49  69  52', '013А', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1302', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦ уч.отделки', 'РБЦ УЧ.ОТДЕЛКИ', '49  05  88', '013Б', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1304', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦрекв', 'РБЦРЕКВ', '49  05  88
49  12  61', '013Г', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1306', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦогнеуп', 'РБЦОГНЕУП', '49  06  29
49  62  29', '013Е', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1307', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦвалки', 'РБЦВАЛКИ', '49  67  63', '013Ж', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1308', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'Уч.стана п/ф,НЗП', 'УЧ.СТАНА П/Ф,НЗП', '49  05  88
49  12  61', '013З', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1309', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'Уч.ст. г/п,осед.', 'УЧ.СТ. Г/П,ОСЕД.', '49  05  88
49  12  61', '013И', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1310', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦ уч.стана', 'РБЦ УЧ.СТАНА', '49  68  70', '013К', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1315', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'Инструмент', 'ИНСТРУМЕНТ', '49  81  23', '013Р', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1321', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦВспом.мат.ШПС', 'РБЦВСПОМ.МАТ.ШПС', '49  63  40
49  66  93', '013Ш', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1323', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'ГП в пути', 'ГП В ПУТИ', NULL, '01323', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1324', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'ГП на о/хранении', 'ГП НА О/ХРАНЕНИИ', NULL, '01324', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1325', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Промежуточный склад', 'КБК', 'РБЦ КБК', NULL, '0131325', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1326', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Промежуточный склад', 'РБЦ ТМЦ ИМ', 'РБЦ ИМ', NULL, '0131326', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1330', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦуч.ШПСмет-лом', 'РБЦУЧ.ШПСМЕТ-ЛОМ', '49  63  40
49  66  93', '013Ч', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1331', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦ ГП,осед.,п/ф', 'ГП,ОСЕДАНИЕ,П/Ф', '49  63  40
49  66  93', '013Щ', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1500', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦ(т/о)мет-лом', 'РБЦ(Т/О)МЕТ-ЛОМ', '49  05  92', '015', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1501', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'Уч.Т/О г/п,осед.', 'УЧ.Т/О Г/П,ОСЕД.', '49  05  88
49  05  92
49  12  61', '015А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1502', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'Уч.Т/О п/ф, НЗП', 'УЧ.Т/О П/Ф, НЗП', '49  05  88
49  05  92
49  12  61', '015Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1503', 'РЕЛЬСОБАЛОЧНЫЙ ЦЕХ', '013', 'Склад МОЛ', 'РБЦ уч.т/о', 'РБЦ УЧ.Т/О', '49  05  92', '015В', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1710', 'САЦ', '171', 'Склад МОЛ', 'САЦ', 'САЦ', NULL, '1710', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6401', 'СМОЛОПЕКОКОКСОВЫЙ ЦЕХ', '064', 'Склад МОЛ', 'Сырье смолоперег', 'СЫРЬЕ СМОЛОПЕРЕГ', '49  18  24
49  18  78
49  19  58', '064А', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6403', 'СМОЛОПЕКОКОКСОВЫЙ ЦЕХ', '064', 'Склад МОЛ', 'Г/п уч.ректифик.', 'Г/П УЧ.РЕКТИФИК.', NULL, '064В', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6404', 'СМОЛОПЕКОКОКСОВЫЙ ЦЕХ', '064', 'Склад МОЛ', 'Г/п смолоперег.', 'Г/П СМОЛОПЕРЕГ.', '49  18  24
49  18  78', '064Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6407', 'СМОЛОПЕКОКОКСОВЫЙ ЦЕХ', '064', 'Склад МОЛ', 'МПЗ смолопер.уч.', 'МПЗ СМОЛОПЕР.УЧ.', '49  19  58
49  73  41', '064С', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6421', 'СМОЛОПЕКОКОКСОВЫЙ ЦЕХ', '064', 'Склад МОЛ', 'СПКЦ - Склад БХУ', 'СПКЦ - СКЛАД БХУ', NULL, '021', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3201', 'ТЕПЛОЭЛЕКТРОЦЕНТРАЛЬ', '032', 'Склад МОЛ', 'ТЭЦ всп,зч,ин.КЦ', 'ТЭЦ ВСП,ЗЧ,ИН.КЦ', '49  10  20', '032Б', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3202', 'ТЕПЛОЭЛЕКТРОЦЕНТРАЛЬ', '032', 'Склад МОЛ', 'ТЭЦ всп,зч,ГСМ,и', 'ТЭЦ ВСП,ЗЧ,ГСМ,И', '49  10  36', '032В', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3203', 'ТЕПЛОЭЛЕКТРОЦЕНТРАЛЬ', '032', 'Склад МОЛ', 'ТЭЦ всп,зч,ин,ТЦ', 'ТЭЦ ВСП,ЗЧ,ИН,ТЦ', '49  18  92
49  60  62
49  60  98', '032Г', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3204', 'ТЕПЛОЭЛЕКТРОЦЕНТРАЛЬ', '032', 'Склад МОЛ', 'ТЭЦ-реаген.матХЦ', 'ТЭЦ-РЕАГЕН.МАТХЦ', '49  01  26
49  10  60
49  12  59
49  17  67
49  63  01
49  63  73', '032Е', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3205', 'ТЕПЛОЭЛЕКТРОЦЕНТРАЛЬ', '032', 'Склад МОЛ', 'ТЭЦ всп,зч,ин.ЭЦ', 'ТЭЦ ВСП,ЗЧ,ИН.ЭЦ', '49  14  98', '032Ж', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3206', 'ТЕПЛОЭЛЕКТРОЦЕНТРАЛЬ', '032', 'Склад МОЛ', 'ТЭЦ всп,зч,ГСМ', 'ТЭЦ ВСП,ЗЧ,ГСМ', '49  60  77', '03206', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3207', 'ТЕПЛОЭЛЕКТРОЦЕНТРАЛЬ', '032', 'Промежуточный склад', 'КБК', 'ТЭЦ КБК', NULL, '0323207', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6601', 'УГЛЕПОДГОТОВИТЕЛЬНЫЙ ЦЕХ КХП', '066', 'Склад МОЛ', 'Углеподготовит.', 'УГЛЕПОДГОТОВИТ.', '49  82  03', '066', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6602', 'УГЛЕПОДГОТОВИТЕЛЬНЫЙ ЦЕХ КХП', '066', 'Склад МОЛ', 'Склад сырья', 'СКЛАД СЫРЬЯ', '49  82  03', '066А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6603', 'УГЛЕПОДГОТОВИТЕЛЬНЫЙ ЦЕХ КХП', '066', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', '49  82  03', '066Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6608', 'УГЛЕПОДГОТОВИТЕЛЬНЫЙ ЦЕХ КХП', '066', 'Склад МОЛ', 'Cклад сырья ПУТ', 'СКЛАД СЫРЬЯ ПУТ', '49  82  03', '066Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6609', 'УГЛЕПОДГОТОВИТЕЛЬНЫЙ ЦЕХ КХП', '066', 'Склад МОЛ', 'Г/п,оседание ПУТ', 'Г/П, ОСЕДАНИЕ ПУТ', NULL, '066Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2200', 'УПИОШЩ', '022', 'Склад МОЛ', 'УПОШЩ', 'УПОШЩ', '49  02  23
49  02  38
49  04  86
49  08  31', '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2201', 'УПИОШЩ', '022', 'Склад МОЛ', 'УПОШЩ СИЗ,всп.', 'УПОШЩ', NULL, '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2202', 'УПИОШЩ', '022', 'Склад МОЛ', 'УПОШЩ ГП', 'УПОШЩ', '49  08  31', '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2203', 'УПИОШЩ', '022', 'Склад МОЛ', 'УПОШЩ Отвал', 'УПОШЩ', '49  08  31', '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2206', 'УПИОШЩ', '022', 'Промежуточный склад', 'УПОШЩ КБК', 'УПОШЩ', NULL, '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1731', 'УПР.НАДЕЖН.ОБОРУД-Я', '173', 'Склад МОЛ', 'УНО', 'УПР.НАДЕЖН.ОБОРУД-Я', NULL, '1731', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1271', 'УПРАВЛ-Е Ж/Д ТРАНСП.', '127', 'Склад МОЛ', 'ЦП ПМ', 'ЦП ПМ', NULL, '1271', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1272', 'УПРАВЛ-Е Ж/Д ТРАНСП.', '127', 'Склад МОЛ', 'ЦП ВСП', 'ЦП ВСП', NULL, '1272', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1273', 'УПРАВЛ-Е Ж/Д ТРАНСП.', '127', 'Склад МОЛ', 'ЦП КС', 'ЦП КС', NULL, '1273', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1274', 'УПРАВЛ-Е Ж/Д ТРАНСП.', '127', 'Склад МОЛ', 'ЦПС', 'ЦПС', NULL, '1274', 'ВЫЕЗД', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7200', 'УПРАВЛ-Е Ж/Д ТРАНСП.', '127', 'Склад МОЛ', 'Служба СЦБ', 'СЛУЖБА СЦБ', '49  17  45', '712', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7900', 'УПРАВЛ-Е Ж/Д ТРАНСП.', '127', 'Склад МОЛ', 'Цех эксплуатации', 'ЦЕХ ЭКСПЛУАТАЦИИ', NULL, '709', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1201', 'УПРАВЛЕНИЕ ГЛАВНОГО ЭНЕРГЕТИКА', '112', 'Склад МОЛ', 'МПЗ УГЭ', 'МПЗ УГЭ', '49  66  53', '112А', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1202', 'УПРАВЛЕНИЕ ГЛАВНОГО ЭНЕРГЕТИКА', '112', 'Промежуточный склад', 'КБК', 'КБК', NULL, '1121202', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2806', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'УПАТ топливо', 'УПАТ ТОПЛИВО', NULL, '028Н', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9900', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'Управление комб.', 'УПРАВЛЕНИЕ КОМБ.', NULL, '099', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9901', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'УСР МПЗ', 'УСР МПЗ', NULL, '099А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9902', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'УСА МПЗ', 'УСА МПЗ', NULL, '099Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9903', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'МПЗ БСЕ', 'МПЗ БСЕ', NULL, '099В', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9904', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'МПЗ 4ОФПС ГПС', 'МПЗ 4ОФПС ГПС', NULL, '099П', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9905', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'МПЗ УОТиПБ', 'МПЗ УОТИПБ', '49  15  64
49  86  19', '099Т', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9906', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'УК МПЗ', 'УК МПЗ', NULL, '099Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9907', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'КБК', 'ПРУ-119 КБК', NULL, '0999907', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9908', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'ИМ Прокат.пр-во', 'ИМ ПРОКАТНОЕ ПРОИЗВОДСТВО', NULL, '0999908', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9911', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'КБК', 'ПЦ-191 КБК', NULL, '0999911', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9912', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'РБЦрек.ИМ', 'РБЦРЕК.ИМ', NULL, '0999912', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9914', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'УПАТ МПЗ', 'УПАТ МПЗ', NULL, '114', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9915', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'КБК СОТ', 'КБК СОТ', NULL, '0999915', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9917', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'МПЗ УпрЭнМен', 'МПЗ УПРЭНМЕН', NULL, '9917', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9918', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'АХУ МПЗ', 'АХУ МПЗ', NULL, '9918', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9921', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'ОЭЗиС ТМЦ ИМ', 'ОЭЗИС ТМЦ ИМ', NULL, '0999921', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9927', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'НТБ СклЛитератур', 'НТБ СКЛ.ЛИТЕРАТУРЫ', NULL, '127', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9928', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Склад МОЛ', 'Склад МПЗ СБК', 'СКЛАД МПЗ СБК', NULL, '528', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9929', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'КБК', 'КБК СБК', NULL, '5289929', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9930', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Склад МОЛ', 'СМЦ', 'СМЦ ПЕРЕПРОДАЖА ЕМАРКЕТ', NULL, '0999930', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9990', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Склад МОЛ', 'Кустов.управлен.', '9020', '49  13  80', '9020', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9991', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'Упр.пред.ц', 'УПР.ПРЕД.Ц', NULL, '191', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9992', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'КБК', 'УК(ТУ)- КБК', NULL, '0999992', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9994', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'КБК', 'УПАТ-103 КБК', NULL, '0999994', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9999', 'УПРАВЛЕНИЕ КОМБИНАТА', '099', 'Промежуточный склад', 'КБК', 'УК КБК', NULL, '0999999', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6501', 'УПРАВЛЕНИЕ КХП', '065', 'Склад МОЛ', 'Управление КХП', 'УПРАВЛЕНИЕ КХП', '49  02  59
49  73  01
49  73  06
49  73  57
49  73  65', '065', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T110', 'УПРАВЛЕНИЕ КХП', '065', 'Промежуточный склад', 'КБК', 'ТРАНЗИТ-КХП МПЗ/КБК', NULL, 'Т110', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T115', 'УПРАВЛЕНИЕ КХП', '065', 'Промежуточный склад', 'КБК', 'ТРАНЗИТ-КХП МПЗ/КБК', NULL, 'Т110', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4290', 'УПРАВЛЕНИЕ ОХРАНЫ ПРИРОДНОЙ СРЕДЫ', '047', 'Склад МОЛ', 'УОПС', 'УОПС', '49  05  31
49  66  59
49  84  43
49  86  14', '042', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4291', 'УПРАВЛЕНИЕ ОХРАНЫ ПРИРОДНОЙ СРЕДЫ', '047', 'Промежуточный склад', 'КБК', 'УОПС КБК', NULL, '0424291', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3100', 'УПРАВЛЕНИЕ ПО ДЕЛАМ ГО И ЧС', '331', 'Склад МОЛ', 'ГОиЧС', 'ГОИЧС', '49  60  33', '180', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3101', 'УПРАВЛЕНИЕ ПО ДЕЛАМ ГО И ЧС', '331', 'Промежуточный склад', 'КБК', 'ГОИЧС КБК', NULL, '3313101', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1860', 'УПРАВЛЕНИЕ ПО РЕМОНТНОМУ ПРОИЗВОДСТВУ', '186', 'Промежуточный склад', 'КБК ОР ТОиР', 'КБК ОР ТОИР', NULL, '1860', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8501', 'УПРАВЛЕНИЕ ПО РЕМОНТНОМУ ПРОИЗВОДСТВУ', '186', 'Склад МОЛ', 'МПЗ УГМ', 'МПЗ УГМ', '49  55  50
49  70  45', '185А', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1601', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УППмет-лом,всп.м', 'УППМЕТ-ЛОМ,ВСП.М', '49  09  38', '516А', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1604', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УППмат.лесоп.уч.', 'УППМАТ.ЛЕСОП.УЧ.', NULL, '516Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1605', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УППмат.для пр-ва', 'УППМАТ.ДЛЯ ПР-ВА', '49  00  48', '516И', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1606', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП гараж', 'УПП ГАРАЖ', '49  61  54', '516М', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1607', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'Нефтепр.обводнен', 'НЕФТЕПР.ОБВОДНЕН', NULL, '516Н', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1608', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УППгот.продукция', 'УППГОТ.ПРОДУКЦИЯ', NULL, '516П', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1610', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП г/п Оседание', 'УПП Г/П ОСЕДАНИЕ', NULL, '516С', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1613', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП ШихтовыйДвор', 'УПП ШИХТОВЫЙДВОР', '49  82  20', '516Ш', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1614', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Промежуточный склад', 'КБК', 'УПП КБК', NULL, '5161614', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1615', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УЦСПО', 'УПП УЦСПО', '49  73  87', '5161615', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1621', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП м/л ЦУОМиГСМ', 'УПП М/Л ЦУОМИГСМ', '49  61  48', '5161621', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1622', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'м/л ЦУОМиГСМ Л/г', 'УПП М/Л ЦУОМИГСМ ЛЕСН.ГОРА', '49  67  09', '5161622', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1623', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП м/л ЦУОМ', 'УПП М/Л ЦУОМ', '49  89  23', '5161623', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1624', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП м/л ших.двор', 'УПП М/Л ШИХТ.ДВОР', NULL, '5161624', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1625', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП м/л ОГП', 'УПП М/Л УЧ.ОГП', '49  11  75', '5161625', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1626', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'м/л сбор,пер.отх', 'УПП М/Л СБОР,ПЕРЕР.ОТХ.', '49  73  87', '5161626', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1627', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП м/л ДОК', 'УПП М/Л УЧ.ДОК', '49  11  75', '5161627', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1628', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'м/л ферроспл.Л/г', 'УПП М/Л ФЕРРОСПЛ.ЛЕСН.ГОРА', NULL, '5161628', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('824Ц', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Центр.склаД 824Ц', 'ЦЕНТРАЛЬНЫЙ СКЛАД 824Ц', NULL, '824Ц', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9002', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.УКОчерн.мет', 'ЦЕН.УКОЧЕРН.МЕТ', '49  13  52', '9002', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9003', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цнтр.УКО имп.з/ч', 'ЦНТР.УКО ИМП.З/Ч', '49  13  64
49  81  39', '8002', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9006', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'ЦенМОПлакокр.м', 'ЦЕНМОПЛАКОКР.М', '49  14  15', '9006', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9009', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.МОПводы,тары', 'ЦЕН.МОПВОДЫ,ТАРЫ', '49  05  21', '9009', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9010', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.КХПогнеуп', 'ЦЕН.КХПОГНЕУП', '49  81  61', '9010', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9011', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.МОПсп.од', 'ЦЕН.МОПСП.ОД', '49  05  21', '9011', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9012', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Инструменты', 'ЦЕНТР.ДП№6ИНСТР', '49  09  38
49  15  95', '9012', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9013', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Универсальный', 'ЦЕН.МОППОДШИПН', '49  06  91
49  16  66
49  16  79
49  62  76
49  65  94', '9013', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9023', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', '9023', '9023', '49  06  91
49  16  66
49  16  79
49  62  76
49  65  94', '9023', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9030', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Склад огнеупоров', 'СКЛАД ОГНЕУПОРОВ', NULL, '9030', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9036', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.УКОцв.мет', 'ЦЕН.УКОЦВ.МЕТ', NULL, '8036', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9044', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.УКО', 'ЦЕН.УКО', '49  61  20
49  83  89', '8044', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9050', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.ЛеснГорИнстр', 'ЦЕН.ЛЕСНГОРИНСТР', '49  17  84
49  60  45', '113*', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9051', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Склад МОЛ', 'УПП (ЗСИ УГМ)', '9051', '49  17  84
49  60  45', '9051', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9054', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.УКОарматуры', 'ЦЕН.УКОАРМАТУРЫ', '49  02  68
49  64  13', '8054', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9097', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', '9097', '9097', '49  15  88', '9097', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9113', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Лом ДМ', '9113', '49  09  38
49  15  95', '9113', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9504', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Отход,ртуть,буАк', 'ЦЕН.РСКМ.ПРОКАТ', '49  73  87', '9504', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9508', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Канцелярс.товары', 'ЦЕН.РСКСТР.МАТ', '49  67  48', '9508', NULL, NULL, 0, 1, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9509', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Склад неликвидов', 'СКЛАД НЕЛИКВИДОВ', '49  09  38
49  15  95', '9509', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9602', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Цен.КЦсырье', 'ЦЕН.КЦСЫРЬЕ', '49  82  20', '9602', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9995', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Центр.склад 9995', 'ЦЕНТРАЛЬНЫЙ СКЛАД 9995', NULL, '5169995', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9996', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Центр.склад 9996', 'ЦЕНТРАЛЬНЫЙ СКЛАД 9996', NULL, '5169996', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9997', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Центр.склад 9997', 'ЦЕНТРАЛЬНЫЙ СКЛАД 9997', NULL, '5169997', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9998', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'Центр.склад 9998', 'ЦЕНТРАЛЬНЫЙ СКЛАД 9998', NULL, '5169998', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('TP99', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Промежуточный склад', 'Скл.об.тары воды', 'СКЛАД ОБОРОТНОЙ ТАРЫ ДЛЯ ВОДЫ', '49  05  21', 'ТР99', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('VWMS', 'УПРАВЛЕНИЕ ПОДГОТОВКИ ПРОИЗВОДСТВА', '516', 'Центральный склад', 'ВиртСклад СУС', 'ВИРТУАЛЬНЫЙ СКЛАД СУС', NULL, 'VWMS', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7700', 'УПРАВЛЕНИЕ РАЗВИТИЯ И СОПРОВОЖДЕНИЯ', '175', 'Склад МОЛ', 'УЖДТупр', 'УЖДТУПР', '49  68  25', '727А', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7701', 'УПРАВЛЕНИЕ РАЗВИТИЯ И СОПРОВОЖДЕНИЯ', '175', 'Промежуточный склад', 'КБК', 'УЖДТ КБК', NULL, '0277701', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9909', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО КОНТРОЛЯ', '559', 'Склад МОЛ', 'УТК', 'УТК', '49  80  39', '109', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9910', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО КОНТРОЛЯ', '559', 'Промежуточный склад', 'КБК', 'КБК УТК', NULL, '5599910', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2310', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО НАДЗОРА И МЕТРОЛОГИИ', '371', 'Склад МОЛ', 'ДИТт/пары,драгМе', 'ДИТТ/ПАРЫ,ДРАГМЕ', '49  63  36
49  65  71', '123А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3710', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО НАДЗОРА И МЕТРОЛОГИИ', '371', 'Склад МОЛ', 'ЛТСИ', 'ЛТСИ', NULL, '3710', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3711', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО НАДЗОРА И МЕТРОЛОГИИ', '371', 'Промежуточный склад', 'МПЗ отд.надзора', 'МПЗ ОТД.НАДЗОРА', NULL, '3711', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3712', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО НАДЗОРА И МЕТРОЛОГИИ', '371', 'Промежуточный склад', 'ИМ ОЭЗиС', 'ИМ ОЭЗИС', NULL, '3712', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9925', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО НАДЗОРА И МЕТРОЛОГИИ', '371', 'Промежуточный склад', 'Скл.от.Гл.метрол', 'СКЛ.ОТ.ГЛ.МЕТРОЛ', '49  19  26', '225А', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1700', 'УПРАВЛЕНИЕ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ И РЕМОНТА', '187', 'Склад МОЛ', 'СТОиР', 'СТОИР', NULL, '1700', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8100', 'УЧАСТОК АВТОТРАНСПОРТА', '080', 'Склад МОЛ', 'Гараж', 'ГАРАЖ', '49  60  37
49  73  97', '080', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4801', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ МПЗ учРР', 'ФЛЦ МПЗ УЧРР', '49  87  27', '348', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4802', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ М/К1 металл', 'ФЛЦ М/К1 МЕТАЛЛ', '49  85  14', '348А', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4803', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ МПЗ учММ', 'ФЛЦ МПЗ УЧММ', '49  04  20
49  12  21
49  85  11', '348Б', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4806', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ М/К1 п/ф нзп', 'ФЛЦ М/К1 П/Ф НЗП', '49  85  14', '348Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4807', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ сырье УЦЛ', 'ФЛЦ СЫРЬЕ УЦЛ', '49  62  81
49  64  70', '348Ж', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4808', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ МПЗ Обр.отд.', 'ФЛЦ П/Ф УСЛ', '49  66  67', '348З', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4809', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ МПЗ УСЛ', 'ФЛЦ МПЗ УСЛ', '49  66  67
49  86  18', '348Л', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4810', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ МПЗ УСЛ, КМУ', 'ФЛЦ Г/П УСЛ', '49  66  67', '348М', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4811', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ г/п УЦЛ', 'ФЛЦ Г/П УЦЛ', '49  62  81
49  64  70', '348Н', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4812', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ п/ф УЦЛ', 'ФЛЦ П/Ф УЦЛ', '49  62  81
49  64  70', '348О', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4813', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦуч к/м вспз/ч', 'ФЛЦУЧ К/М ВСПЗ/Ч', '49  12  05', '348П', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4814', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ М/К1 г/п', 'ФЛЦ М/К1 Г/П', '49  85  14', '348Р', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4815', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ г/п, п/ф', 'ФЛЦ Г/П, П/Ф', NULL, '348Т', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4816', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ гот.п/ф.ин.', 'ФЛЦ ГОТ.П/Ф.ИН.', '49  86  18', '348Ш', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4818', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Промежуточный склад', 'КБК', 'КБК', NULL, '3484818', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4819', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Склад МОЛ', 'ФЛЦ МПЗ м/к эст.', 'ФЛЦ Г/П, П/Ф', NULL, '348Т', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8026', 'ФАСОННО-ЛИТЕЙНЫЙ ЦЕХ', '348', 'Центральный склад СП', 'ФЛЦ МПЗ', 'ФЛЦ МПЗ', '49  67  48', '8026', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8401', 'ЦЕНТРАЛЬНАЯ ЛАБОРАТОРИЯ КОМБИНАТА', '184', 'Склад МОЛ', 'ЦЛКмбп,всп.м,з/ч', 'ЦЛК МБП,ВСП.М,З/Ч', '49  00  89
49  11  34
49  18  84', '184А', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8402', 'ЦЕНТРАЛЬНАЯ ЛАБОРАТОРИЯ КОМБИНАТА', '184', 'Склад МОЛ', 'ЦЛК уч.по рем.', 'ЦЛК УЧ.ПО РЕМ.', '49  12  56
49  89  94', '184Р', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8403', 'ЦЕНТРАЛЬНАЯ ЛАБОРАТОРИЯ КОМБИНАТА', '184', 'Склад МОЛ', 'ЦЛК исп.центр', 'ЦЛК ИСП.ЦЕНТР', '49  75  59', '184Л', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8404', 'ЦЕНТРАЛЬНАЯ ЛАБОРАТОРИЯ КОМБИНАТА', '184', 'Промежуточный склад', 'КБК', 'ЦЛК КБК', NULL, '1848404', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8405', 'ЦЕНТРАЛЬНАЯ ЛАБОРАТОРИЯ КОМБИНАТА', '184', 'Склад МОЛ', 'МПЗ лаб.КХП', 'ЦЛК МПЗ КХП', '49  62  42
49  00  83', '1848405', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T100', 'ЦЕНТРАЛЬНЫЕ СКЛАДЫ НТМК', '000', 'Промежуточный склад', 'транзит-сырье', 'ТРАНЗИТ-СЫРЬЕ', NULL, 'Т100', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T104', 'ЦЕНТРАЛЬНЫЕ СКЛАДЫ НТМК', '000', 'Промежуточный склад', 'транзит-вспомМат', 'ТРАНЗИТ-ВСПОММАТ', NULL, 'Т104', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('TB09', 'ЦЕНТРАЛЬНЫЕ СКЛАДЫ НТМК', '000', 'Центральный склад', 'Транзит Баранча', 'ТРАНЗИТ БАРАНЧА', NULL, 'Б909', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('TY09', 'ЦЕНТРАЛЬНЫЕ СКЛАДЫ НТМК', '000', 'Центральный склад', 'Транзит Уралец', 'ТРАНЗИТ УРАЛЕЦ', NULL, 'У909', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3502', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Склад МОЛ', 'ЦВС всп,з/ч,инвЭ', 'ЦВС ВСП,З/Ч,ИНВЭ', '49  67  86', '035Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3503', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Склад МОЛ', 'ЦВС НТМЗ', 'ЦВС НТМЗ', '49  15  24
49  87  02', '035В', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3504', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Склад МОЛ', 'ЦВС всп,зч,инвГТ', 'ЦВС ВСП,ЗЧ,ИНВГТ', '49  87  28', '035Д', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3505', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Склад МОЛ', 'ЦВС реаг,всп,инв', 'ЦВС РЕАГ,ВСП,ИНВ', '49  87  18', '035Е', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3506', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Склад МОЛ', 'ЦВС всп,зч,инв.С', 'ЦВС ВСП,ЗЧ,ИНВ.С', '49  61  68
49  83  57', '035Ж', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3507', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Склад МОЛ', 'ЦВС НТМЗ', 'ЦВС НТМЗ', '49  04  35
49  15  24', '035К', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3508', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Склад МОЛ', 'ЦВС НТМЗ', 'ЦВС НТМЗ', '49  04  35
49  15  24', '035Л', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3509', 'ЦЕХ ВОДОСНАБЖЕНИЯ', '035', 'Промежуточный склад', 'КБК', 'ЦВС КБК', NULL, '0353509', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5201', 'ЦЕХ ОБЖИГА ИЗВЕСТНЯКА', '592', 'Склад МОЛ', 'ЦОИсырье', 'ЦОИСЫРЬЕ', NULL, '592А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5202', 'ЦЕХ ОБЖИГА ИЗВЕСТНЯКА', '592', 'Склад МОЛ', 'ЦОИг/п,осед', 'ЦОИГ/П,ОСЕД', NULL, '592В', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5203', 'ЦЕХ ОБЖИГА ИЗВЕСТНЯКА', '592', 'Склад МОЛ', 'ЦОИ', 'ЦОИ', '49  71  50', '592Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5204', 'ЦЕХ ОБЖИГА ИЗВЕСТНЯКА', '592', 'Склад МОЛ', 'Склад ТМЦ', 'СКЛАД ТМЦ', '49  71  50', '592М', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5205', 'ЦЕХ ОБЖИГА ИЗВЕСТНЯКА', '592', 'Склад МОЛ', 'Склад ТМЦ', 'СКЛАД ТМЦ', NULL, '592Э', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5206', 'ЦЕХ ОБЖИГА ИЗВЕСТНЯКА', '592', 'Промежуточный склад', 'КБК ЦОИ', 'ЦОИ КБК', NULL, '5925206', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5901', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'УУВГМ ЦОА', 'УУВГМ ЦОА', '49  16  38
49  64  29', '359', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5902', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Сляб ТМЦ', 'СЛЯБ ТМЦ', '49  61  73
49  86  28', '359А', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5903', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Балка ТМЦ', 'БАЛКА ТМЦ', '49  03  26
49  81  51
49  86  71', '359Б', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5904', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Сорт ТМЦ', 'СОРТ ТМЦ', '49  13  37
49  66  38', '359В', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5905', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Сляб лом, отход', 'СЛЯБ ЛОМ, ОТХОД', '49  61  73
49  86  28', '359Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5906', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Балка лом, отход', 'БАЛКА ЛОМ, ОТХОД', '49  03  26
49  81  51
49  86  71', '359Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5907', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Сорт лом, отход', 'СОРТ ЛОМ, ОТХОД', '49  13  37
49  66  38', '359Е', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5908', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Сляб п/ф, ГП', 'СЛЯБ П/Ф, ГП', '49  61  73
49  86  28', '359К', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5911', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Сорт п/ф, ГП', 'СОРТ П/Ф, ГП', '49  13  37
49  66  38', '359Р', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5913', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Склад МОЛ', 'Балка п/ф, ГП', 'БАЛКА П/Ф, ГП', '49  03  26
49  81  51
49  86  71', '359Ш', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5915', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Промежуточный склад', 'КБК', 'ЦОА КБК', NULL, '3595915', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5916', 'ЦЕХ ОБЪЕДИНЕННЫХ АДЪЮСТАЖЕЙ', '359', 'Промежуточный склад', 'ЦОА ТМЦ ИМ', 'ЦОА ИМ', NULL, '3595916', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0607', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'МехОб МНЛЗ №1-4', 'МЕХОБ МНЛЗ №1-4', '49  08  76
49  84  86', '006Г', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0610', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'Механики МНЛЗ№4', 'МЕХАНИКИ МНЛЗ№4', '49  75  53', '006Ж', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3661', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'Мех. служба ДОК', 'МЕХ.СЛУЖБА ЦРМО', NULL, '3661', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('806М', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Центральный склад СП', 'КС ЦРМО', 'КС ЦРМО', NULL, '806М', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8202', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'Огн. КБ5-6 КЦ3', 'ОГН. КБ5-6 КЦ3', '49  12  18', '068Д', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8208', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'Огнеупоры д/рем.', 'ОГНЕУПОРЫ Д/РЕМ.', '49  17  24
49  18  53', '082К', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9201', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОиП', 'ЦРМОИП', '49  16  74', '092', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9202', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОиПуч.рем.ТТА', 'ЦРМОИПУЧ.РЕМ.ТТА', '49  87  09', '092А', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9203', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОиПучСПСог.из', 'ЦРМОИПУЧСПСОГ.ИЗ', NULL, '092Б', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9204', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОиП з/ч гараж', 'ЦРМОИП З/Ч ГАРАЖ', '49  13  95', '092В', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9205', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'Смешанные м-лы', 'СМЕШАННЫЕ М-ЛЫ', NULL, '092П', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9206', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОиПуч.рем.об.', 'ЦРМОИПУЧ.РЕМ.ОБ.', '49  14  24', '092Р', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9207', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОиП всп.мат.', 'ЦРМОИП ВСП.МАТ.', '49  01  56
49  04  84', '092Т', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9208', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОиП Произ.уч.', 'ПРОИЗВОДСТВЕН.УЧАСТОК', NULL, '9208', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9209', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Промежуточный склад', 'КБК', 'ЦРМОИП КБК', NULL, '0929209', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9290', 'ЦЕХ ПО РЕМОНТУ МЕХАНИЧЕСКОГО ОБОРУДОВАНИЯ', '366', 'Склад МОЛ', 'ЦРМОэлектрослуж.', 'ЭЛЕКТРОСЛУЖБА ЦРМО', NULL, '3662', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0401', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Склад МОЛ', 'ЦРЭлО всп,з/ч,ин', 'ЦРМЭ ВСП,З/Ч,ИНВ', '49  09  32
49  61  17', '004А', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0402', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Промежуточный склад', 'КБК ЦРМЭ', 'ЦРМЭ КБК', NULL, '0040402', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3008', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Склад МОЛ', 'Склад МПЗ', 'СКЛАД МПЗ', '49  61  37', '0303008', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4102', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Склад МОЛ', 'ЦРЭлО всп.М', 'ЭЛРЦ ВСП.М', '49  08  72', '041Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4103', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Склад МОЛ', 'ЭлРЦ всп.Э', 'ЭЛРЦ ВСП.Э', NULL, '041В', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4104', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Промежуточный склад', 'КБК', 'ЭЛРЦ КБК', NULL, '0414104', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8008', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Центральный склад СП', 'ЭлРЦ МПЗ', 'ЭЛРЦ МПЗ', NULL, '8008', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('9808', 'ЦЕХ ПО РЕМОНТУ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '367', 'Центральный склад', 'Электродвигатели', 'ЭЛЕКТРОДВИГАТЕЛИ В ЭЛРЦ', NULL, '0419808', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4601', 'ЦЕХ ПО РЕМОНТУ ЭНЕРГЕТИЧЕСКОГО ОБОРУДОВАНИЯ', '368', 'Склад МОЛ', 'ЭнРЦ всп,з/ч,инв', 'ЭНРЦ ВСП,З/Ч,ИНВ', '49  07  25
49  11  17
49  18  31
49  87  89', '046А', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4602', 'ЦЕХ ПО РЕМОНТУ ЭНЕРГЕТИЧЕСКОГО ОБОРУДОВАНИЯ', '368', 'Промежуточный склад', 'КБК', 'КБК', '49  18  31
49  87  89', '0464602', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2002', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБ УСПК', 'ЦПШБ УСПК', '49  80  91', '020Б', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2003', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБтехнолог.', 'ЦПШБ ТЕХНОЛОГ.', '49  71  46
49  86  04', '020В', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2004', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБкат-ка,рекв', 'ЦПШБКАТ-КА,РЕКВ', '49  89  71', '020Г', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2005', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБ Мет.отходы', 'ЦПШБ МЕТ.ОТХОДЫ', '49  89  71', '020Д', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2006', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБвалки', 'ЦПШБ ВАЛКИ', '49  86  27', '020Е', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2007', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБ инструмент', 'ЦПШБ ИНСТРУМЕНТ', NULL, '020Ж', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2008', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБогнеуп', 'ЦПШБ ОГНЕУП', '49  86  40', '020З', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2009', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ГП,оседание, п/ф', 'ГП,ОСЕДАНИЕ, П/Ф', '49  84  96', '020И', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2010', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'всп.мат.хоз.инв.', 'ВСП.МАТ.ХОЗ.ИНВ.', NULL, '020К', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2011', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБ незаверш.пр', 'ЦПШБ НЕЗАВЕРШ.ПР', '49  84  96', '020Л', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2012', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБ металл', 'ЦПШБ МЕТАЛЛ', '49  84  96', '020М', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2015', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ГП в пути', 'ГП В ПУТИ', NULL, '020П', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2019', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'П/ф п/д станом', 'П/Ф П/Д СТАНОМ', '49  71  46
49  86  04', '020У', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2021', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ГП на о/хранении', 'ГП НА О/ХРАНЕНИИ', NULL, '020Х', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2030', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБ внешн.склад', 'ЦПШБ ВНЕШНИЙ СКЛАД', '49  71  01', '2030', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2032', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Склад МОЛ', 'ЦПШБ УСБ', 'ЦПШБ УСБ', '49  71  01', '0202032', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('821Т', 'ЦЕХ ПРОКАТКИ ШИРОКОПОЛОЧНЫХ БАЛОК', '020', 'Центральный склад СП', 'Куст.ЦПШБ', 'КУСТОВОЙ ЦПШБ', NULL, '821Т', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3690', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ', '369', 'Склад МОЛ', 'ЦСО МПЗ уч. КХП', 'ЦСО МПЗ УЧ.КХП', NULL, '3690', 'КХП', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3691', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ', '369', 'Промежуточный склад', 'КБК ЦСО УРП', 'КБК ЦСО УРП', NULL, '3691', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4804', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ', '369', 'Склад МОЛ', 'ЦСО МПЗ учЭл', 'ФЛЦ МПЗ УЧЭЛ', '49  68  60', '348В', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('4805', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ', '369', 'Склад МОЛ', 'ЦСО МПЗ учМех', 'ФЛЦ МПЗ УЧМЕХ', '49  68  61', '348Г', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5403', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ', '369', 'Склад МОЛ', 'ЦСО МПЗ элМЦ', 'ЦРМО3З/Ч ЭЛЕКТР.', NULL, '354В', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5404', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ', '369', 'Склад МОЛ', 'ЦСО МПЗ мехМЦ', 'ЦРМО3 З/Ч МЕХАН.', '49  70  87', '354Г', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0111', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'Мехслужба', 'МЕХСЛУЖБА', '49  16  03
49  64  33
49  66  91
49  66  99
49  69  13
49  86  68
49  89  10', '001М', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0112', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'Гидравлики', 'ГИДРАВЛИКИ', '49  85  75', '001Н', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0118', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'ПУТ, Ремслужба', 'ПУТ,РЕМСЛУЖБА', '49  77  59', '001У', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0120', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'Электрослужба', 'ЭЛЕКТРОСЛУЖБА', '49  69  50
49  83  11', '001Э', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0121', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'Энергослужба', 'ЭНЕРГОСЛУЖБА', NULL, '0010121', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2204', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'УПОШЩ Электр.', 'УПОШЩ', '49  02  23', '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2205', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'УПОШЩ Мех.', 'УПОШЩ', '49  02  38', '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2207', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Склад МОЛ', 'УПОШЩ энергет.', 'УПОШЩ', NULL, '0222200', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8025', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ДОМЕННОГО ПРОИЗВОДСТВА', '362', 'Центральный склад СП', 'ДЦ МПЗ', 'ДЦ МПЗ', '49  81  98', '8025', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3610', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'ЦСО КХП МПЗ', 'ЦСО КХП МПЗ', NULL, '3610', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6406', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ мех.СПКЦ', 'МПЗ МЕХ.СПКЦ', '49  02  65
49  06  73
49  19  58', '064М', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6408', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ эл.СПКЦ', 'МПЗ ЭЛ.СПКЦ', '49  19  58
49  19  62
49  73  72', '064Э', 'КХП', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6604', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ мех.УПЦ', 'МПЗ МЕХ.УПЦ', '49  05  30
49  10  52', '066М', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('6607', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ эл.УПЦ', 'МПЗ ЭЛ.УПЦ', '49  65  27
49  68  42', '066Э', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8203', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'Мех КБ5-6', 'МЕХ КБ5-6', '49  02  00
49  68  77', '068М', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8209', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ мех.КЦ№3', 'МПЗ МЕХ.КЦ№3', '49  00  29
49  60  19
49  68  77', '082М', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8211', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ эл.КБ9-10', 'МПЗ ЭЛ.КБ9-10', '49  08  73
49  15  28', '082Э', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8303', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ мех.КБ5-6', 'МПЗ МЕХ.КБ5-6', '49  08  76
49  14  52
49  19  30
49  69  64', '071М', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8307', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ мех.УЛ№3', 'МПЗ МЕХ.УЛ№3', '49  08  76
49  19  30', '083М', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8308', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'МПЗ эл.УЛ№3', 'МПЗ ЭЛ.УЛ№3', '49  62  68
49  80  10', '083Э', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8602', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Склад МОЛ', 'Металл РМЦ', 'МЕТАЛЛ РМЦ', '49  15  16', '086М', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T113', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Промежуточный склад', 'Транзитный склад', 'ТРАНЗИТ-КХП КБК', NULL, 'Т113', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('T118', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОКСОХИМИЧЕСКОГО ПРОИЗВОДСТВА', '361', 'Промежуточный склад', 'КБК', 'ТРАНЗИТ-КХП МПЗ/КБК', NULL, 'Т110', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0909', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'Подъем.сооруж.БС', 'БС ПОДЪЕМН.СООРУЖ.', NULL, '0110909', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0910', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'УГП БС', 'УГП БС МЕХ.СЛУЖБА', NULL, '0110910', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0911', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'Копр.отд.т/п БС', 'КОПР.ОТД.Т/П БС', NULL, '009П', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0912', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'БС эл.служба', 'БС ЭЛ.СЛУЖБА', NULL, '009Х', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1009', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КПС эл.служба', 'КПС ЭЛ.СЛУЖБА', '49  11  60', '010Э', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1111', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Промежуточный склад', 'КБЦ ИМ', 'КБЦ ИМ', NULL, '0111111', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1127', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КБЦ МС ЛВК', 'КБЦ МС ЛВК', NULL, '011Е', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1128', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КБЦ МС МО', 'КБЦ МС МО', NULL, '011Ж', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1130', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КБЦ МС УНУиТОК', 'КБЦ МС УНУИТОК', NULL, '011Л', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1131', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КПС Эн.об.мех.с', 'КПС ЭН.ОБ.МЕХ.С', NULL, '011Н', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1132', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КБЦ МС ППЛ', 'КБЦ МС ППЛ', NULL, '011П', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1133', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КБЦ МС кранов.', 'КБЦ МС КРАНОВ.', NULL, '011С', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1134', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'КБЦ МС гидрав.', 'КБЦ МС ГИДРАВ.', NULL, '011Ч', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2315', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'ЦСО КБП эл. з/ч', 'ДИТ.КБЦ З/Ч Б/У', NULL, '123К', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2317', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'ЦСО КБП эл. з/ч', 'ДИТ.КБЦ З/Ч Б/У', NULL, '123С', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2319', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'ЦСО КБП эл. з/ч', 'ДИТ.КБЦ З/Ч Б/У', NULL, '123У', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2320', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Склад МОЛ', 'ЦСО КБП эл. з/ч', 'ДИТУЧ.АСУ ТП КБЦ', '49  81  11', '123Э', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8024', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ КОЛЕСОБАНДАЖНОГО ПРОИЗВОДСТВА', '365', 'Центральный склад СП', 'КБЦ МПЗ', 'КБЦ МПЗ', NULL, '8024', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1303', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Эл.об.машзал', 'РБЦ ЭЛ.ОБ.МАШЗАЛ', '49  63  62', '013В', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1305', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Мех.об.комм', 'РБЦ МЕХ.ОБ.КОММ', '49  09  21', '013Д', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1311', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Мех.об.уч.ст', 'РБЦ МЕХ.ОБ.УЧ.СТ', '49  64  59', '013Л', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1312', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ мех.служба', 'РБЦ МЕХ.СЛУЖБА', '49  65  64
49  83  26', '013М', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1313', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Эл.об.уч.ст', 'РБЦ ЭЛ.ОБ.УЧ.СТ', '49  07  97', '013Н', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1314', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Мех.об.краны', 'РБЦ МЕХ.ОБ.КРАНЫ', '49  70  25', '013П', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1316', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Мех.об.уч.от', 'РБЦ МЕХ.ОБ.УЧ.ОТ', NULL, '013С', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1317', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Мех.об.термо', 'РБЦ МЕХ.ОБ.ТЕРМО', '49  64  45', '013Т', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1318', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Эл.об.уч.отд', 'РБЦ ЭЛ.ОБ.УЧ.ОТД', '49  16  27', '013У', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1319', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Эл.об.тормо', 'РБЦ ЭЛ.ОБ.ТОРМО', '49  63  62', '013Х', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1320', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ Мех.об.учККЭ', 'РБЦ МЕХ.ОБ.УЧККЭ', NULL, '013Ц', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1322', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦ элек.служба', 'РБЦ ЭЛЕК.СЛУЖБА', '49  00  78
49  07  97', '013Э', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1333', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'РБЦМех.об.уч.ШПС', 'РБЦМЕХ.ОБ.УЧ.ШПС', '49  02  94', '013Я', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1403', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-ЭлектрикиШПС', 'КСЦ ЭЛЕКТРИКИШПС', '49  65  37', '014В', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1407', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-МС СТ', 'КСЦ МС СТ', '49  83  16', '014Ж', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1413', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-МС КР', 'КСЦ МС КР', '49  60  95', '014Н', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1421', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-МС СМ', 'КСЦ МС СМ', '49  60  12', '014Х', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1422', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-ЭС МЗ', 'КСЦ ЭС МЗ', NULL, '014Ц', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1423', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-ЭС ОТ', 'КСЦ ЭС ОТ', '49  18  64', '014Ч', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1424', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-Механики ШПС', 'КСЦ МЕХАНИКИ ШПС', '49  67  51', '014Ш', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1425', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-ММ,МС ОТ', 'КСЦ ММ,МС ОТ', NULL, '014Щ', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('1426', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'КСЦ-ЭлектрикиКСС', 'КСЦ ЭЛЕКТРИКИКСС', '49  17  90
49  18  66', '014Э', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2001', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ мех МП', 'ЦПШБ МЕХ МП', '49  80  20
7  61  15
7  61  49', '020А', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2013', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ мех СТ', 'ЦПШБ МЕХ СТ', '49  80  20', '020Н', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2014', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ мех КР', 'ЦПШБ МЕХ КР', NULL, '020О', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2016', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ мех ГИД', 'ЦПШБ МЕХ ГИД', NULL, '020Р', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2017', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ ЭН', 'ЦПШБ ЭН', '49  69  80
49  85  54', '020С', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2018', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ - Механики', 'ЦПШБ МЕХАНИКИ', '49  68  37
49  86  53', '020Т', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2020', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ элек УБС', 'ЦПШБ ЭЛЕК УБС', NULL, '020Ф', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2022', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ мех ВТМ', 'ЦПШБ МЕХ ВТМ', NULL, '020Ч', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2023', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ элек ОТД', 'ЦПШБ ЭЛЕК ОТД', '49  15  41', '020Ш', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2024', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ мех ОТД', 'ЦПШБ МЕХ ОТД', NULL, '020Щ', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2025', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ элек ГПМ', 'ЦПШБ ЭЛЕК ГПМ', NULL, '020Ы', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2026', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ - Электрики', 'ЦПШБ ЭЛЕКТРИКИ', '49  86  44', '020Э', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2027', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ элек ДН', 'ЦПШБ ЭЛЕК ДН', NULL, '020Ю', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2028', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦПШБ элек МЗ', 'ЦПШБ ЭЛЕК МЗ', NULL, '020Я', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5909', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦОА-Электр.балка', 'ЦОА-ЭЛЕКТР.БАЛКА', '49  84  94', '359Л', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5910', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦОА-Механ. сорт', 'ЦОА-МЕХАН. СОРТ', '49  58  21', '359М', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5912', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦОА-Механ. балка', 'ЦОА-МЕХАН. БАЛКА', '49  89  61
7  62  89', '359Х', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('5914', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Склад МОЛ', 'ЦОА-Электр. сорт', 'ЦОА-ЭЛЕКТР. СОРТ', '49  14  76
49  84  90
49  85  23', '359Э', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8021', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Центральный склад СП', 'МПЗ', 'МПЗ', NULL, '8021', 'НТМК', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8023', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ПРОКАТНОГО ПРОИЗВОДСТВА', '364', 'Центральный склад СП', 'КСЦ МПЗ', 'КСЦ МПЗ', '49  84  19', '8023', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0601', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'Мех.кранов УНРС', 'МЕХ.КРАНОВ УНРС', '49  17  84
49  67  09
49  68  10
49  75  39', '006V', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0602', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'МехОбр микс.отд.', 'МЕХОБР МИКС.ОТД.', '49  09  01
49  61  35
49  80  48', '006R', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0604', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'Энергослужба КО', 'ЭНЕРГОСЛУЖБА КО', '46  58  69
49  17  98
49  83  39', '006А', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0623', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'МехОб МНЛЗ-4', 'МЕХОБ МНЛЗ-4', NULL, '006Ф', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0624', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'МехОб МНЛЗ№2 ПК', 'МЕХОБ МНЛЗ№2 ПК', NULL, '006Х', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0625', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'МехОб МНЛЗ №1,3', 'МЕХОБ МНЛЗ №1,3', '49  75  56', '006Ц', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0629', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'Электрослужба', 'ЭЛЕКТРОСЛУЖБА', '49  11  93', '006Э', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0631', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'ЭнергослужбаУНРС', 'ЭНЕРГОСЛУЖБАУНРС', '49  02  76
49  05  23', '006Я', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0634', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Склад МОЛ', 'Механики ВОС', 'МЕХАНИКИ ВОС', '49  13  51', '0060634', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('0635', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Промежуточный склад', 'КБК', 'КБК', NULL, '0060635', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8006', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ СТАЛЕПЛАВИЛЬНОГО ПРОИЗВОДСТВА', '363', 'Центральный склад СП', 'Куст.КЦ з/ч', 'КУСТ.КЦ З/Ч', '49  07  46
49  67  61
49  84  39', '9022', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2802', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'АТЦ СОЖ и масла', 'АТЦ СОЖ И МАСЛА', '49  71  95', '028Б', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2804', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'АТЦ запас.части', 'АТЦ ЗАПАС.ЧАСТИ', '49  71  95', '028З', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('2808', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Промежуточный склад', 'КБК ЦСО ТИ', 'КБК ЦСО ТИ', NULL, '3722808', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7000', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'ЦРиЭЛ', 'ЦРИЭЛ', '49  62  79
49  84  10', '7107000', 'ВЫЕЗД', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7001', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'ЦРиЭЛ ГСМ', 'ЦРИЭЛ ГСМ', '49  86  51', '7107001', 'ВЫЕЗД', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7002', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'ЦРиЭЛ', 'ЦРИЭЛ', '49  86  51', '7107002', 'ВЫЕЗД', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7100', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'СГМ УЖДТ', 'СГМ УЖДТ', '49  82  27', '711', 'ВЫЕЗД', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7301', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'ЦСО Цех пути', 'ЦЕХ ПУТИ', '49  08  19
49  10  71', '713А', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7302', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'ЦСО УТОиР', 'ЦЕХ ПУТИ', '49  13  44', '713Б', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7500', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'Цех эксплуатации', 'ЦЕХ ЭКСПЛУАТАЦИИ', '49  12  98
49  82  27', '715', 'ВЫЕЗД', 'ЧТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('7600', 'ЦЕХ СЕРВИСНОГО ОБСЛУЖИВАНИЯ ТРАНСПОРТНОЙ ИНФРАСТРУКТУРЫ', '372', 'Склад МОЛ', 'УЖДТэл.и эн.хоз', 'УЖДТЭЛ.И ЭН.ХОЗ', '49  06  86
49  19  09', '716А', 'НТМК', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3301', 'ЦЕХ СЕТЕЙ И ПОДСТАНЦИЙ', '033', 'Склад МОЛ', 'учСиП лом,б/уМПЗ', 'УЧСИП ЛОМ,Б/УМПЗ', NULL, '033Л', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8301', 'ЦЕХ УЛАВЛИВАНИЯ №3 КХП', '083', 'Склад МОЛ', 'Склад сырья', 'СКЛАД СЫРЬЯ', NULL, '071А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8304', 'ЦЕХ УЛАВЛИВАНИЯ №3 КХП', '083', 'Склад МОЛ', 'ЦехУлавливания3', 'ЦЕХУЛАВЛИВАНИЯ3', '49  00  54', '083', 'КХП', 'СР', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8305', 'ЦЕХ УЛАВЛИВАНИЯ №3 КХП', '083', 'Склад МОЛ', 'Склад сырья', 'СКЛАД СЫРЬЯ', NULL, '083А', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8306', 'ЦЕХ УЛАВЛИВАНИЯ №3 КХП', '083', 'Склад МОЛ', 'г/п, оседание', 'Г/П, ОСЕДАНИЕ', NULL, '083Г', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3001', 'ЦЕХ ЭКСПЛУАТАЦИИ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '030', 'Склад МОЛ', 'ЦЭЭО', 'ЦЭЭО', '49  04  32', '030А', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3002', 'ЦЕХ ЭКСПЛУАТАЦИИ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '030', 'Склад МОЛ', 'ЦЭЭО', 'ЦЭЭО', NULL, '030Б', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3003', 'ЦЕХ ЭКСПЛУАТАЦИИ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '030', 'Промежуточный склад', 'ЦЭЭО Транзит ИМ', 'ЦЭЭО НУЙКИН А.И.', NULL, '3003', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3004', 'ЦЕХ ЭКСПЛУАТАЦИИ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '030', 'Промежуточный склад', 'ЦЭЭО Транзит ИМ', 'ЦЭЭО СМИРНОВ Д.С.', NULL, '3004', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3005', 'ЦЕХ ЭКСПЛУАТАЦИИ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '030', 'Промежуточный склад', 'КБК', 'ЦЭЭО КБК', NULL, '0303005', NULL, NULL, 0, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3006', 'ЦЕХ ЭКСПЛУАТАЦИИ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '030', 'Склад МОЛ', 'ЦЭЭО УРЭККЦ', 'ЦЭЭО УРЭККЦ', '49  07  48', '0303006', 'НТМК', 'ПТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3007', 'ЦЕХ ЭКСПЛУАТАЦИИ ЭЛЕКТРИЧЕСКОГО ОБОРУДОВАНИЯ', '030', 'Склад МОЛ', 'ЦЭЭО УРЭЭЦ', 'ЦЭЭО УРЭЭЦ', '49  15  32
49  67  86
49  84  12', '0303007', 'НТМК', 'ВТ', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3403', 'ЦЕХ ЭНЕРГОСНАБЖЕНИЯ', '370', 'Склад МОЛ', 'ПСЦ всп,з/ч,ГСМВ', 'ПСЦ ВСП,З/Ч,ГСМВ', '49  17  92
49  81  20
49  86  39', '034Г', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('3404', 'ЦЕХ ЭНЕРГОСНАБЖЕНИЯ', '370', 'Склад МОЛ', 'ПСЦ всп,з/ч,ГСМС', 'ПСЦ ВСП,З/Ч,ГСМС', '49  63  46', '034Е', 'НТМК', 'ПН', 1, 0, 0);
INSERT OR REPLACE INTO warehouses (id, shop_name, shop_code, description, designation, keeper, work_phone, legacy_id, cluster, delivery_day, in_schedule, is_shipping, is_removed)
  VALUES ('8101', 'ЦЕХ ЭНЕРГОСНАБЖЕНИЯ', '370', 'Склад МОЛ', 'МПЗ Эн.цеха', 'МПЗ ЭН.ЦЕХА', '49  06  50
49  17  32
49  17  56
49  88  30', '081П', 'КХП', 'ПН', 1, 0, 0);
