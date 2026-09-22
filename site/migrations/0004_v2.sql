-- The War On News v2 (brief 2026-09-22): tactics, countries, v2 incident
-- fields, incident_tactics, coverage_items, events de-duplication and a
-- UNIQUE index on events. Reference data (tactics, countries) is seeded
-- here; record content still enters only through the admin API.
--
-- The incidents table is rebuilt because SQLite cannot change a CHECK
-- constraint in place (level becomes the tier of government: national,
-- state_or_province, municipal, supranational; type becomes optional).
-- D1 enforces foreign keys and this file is applied one statement per
-- HTTP call, so the rebuild keeps every statement FK-consistent on its
-- own: copy the child rows aside, empty the children, rebuild the parent,
-- put the children back (events de-duplicated on the way), drop the copies.

CREATE TABLE IF NOT EXISTS tactics (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  first_recorded_on TEXT,
  notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO tactics (slug, name, definition, sort, updated_at) VALUES
('access_ban', 'Access bans', 'A government or official bars a reporter or a news organisation from places or events where news is gathered: briefings, government buildings, press pools, official trips or court hearings. The ban may be announced, or made by refusing entry without notice. It does not stop publication, but it cuts reporters off from officials and from events that other outlets can still cover.', 1, '2026-09-22T00:00:00Z'),
('credential_control', 'Credential control', 'A government decides who counts as a journalist through passes, accreditation or licences issued to individual reporters. Officials may refuse, suspend or revoke these credentials, or attach new conditions to them. Because many press areas admit only accredited reporters, control of credentials works as control of access.', 2, '2026-09-22T00:00:00Z'),
('outlet_licensing', 'Licensing and closure of outlets', 'A government requires newspapers, broadcasters or news websites to register or to hold a licence, and uses that power to refuse, suspend or cancel it, or to close the outlet. Broadcast licences, which governments issue because radio and television frequencies are limited, are a common lever.', 3, '2026-09-22T00:00:00Z'),
('prior_restraint', 'Prior restraint', 'An order or rule that stops something from being published before it appears, rather than penalising it afterwards. Examples are boards that must approve articles, books or films before release, court injunctions against publication, and rules that require officials to review material before it is published.', 4, '2026-09-22T00:00:00Z'),
('secrets_and_espionage_laws', 'Secrets and espionage laws', 'Laws that make it a crime to obtain, keep or disclose information a government has classified as secret, such as the Espionage Act, a 1917 United States law against disclosing defence information, or the Official Secrets Acts of the United Kingdom. Governments use them to prosecute journalists or, more often, the officials who gave journalists information.', 5, '2026-09-22T00:00:00Z'),
('insult_and_defamation_laws', 'Insult and defamation laws', 'Laws that make it a crime, not only a civil wrong, to damage a person''s reputation, to insult a head of state or a monarch (known as lèse-majesté), or to publish information that a government declares false, including laws against "fake news". Convictions can bring fines or prison.', 6, '2026-09-22T00:00:00Z'),
('surveillance_and_subpoenas', 'Surveillance and subpoenas', 'A government collects journalists'' communications or records, often to learn who their sources are. Methods include subpoenas (court orders to hand over records or to testify), search warrants, seizure of phones and notes, demands to telephone and internet companies, and spyware placed on reporters'' devices.', 7, '2026-09-22T00:00:00Z'),
('funding_and_ownership_pressure', 'Funding and ownership pressure', 'A government uses money, or its power over owners, instead of acting against reporters directly. Examples are cutting the funds of public broadcasters, forcing the sale of an outlet, steering state advertising away from some publications, and using licence reviews or merger approvals to press an outlet''s owners.', 8, '2026-09-22T00:00:00Z'),
('expulsion_and_visa_denial', 'Expulsion and visa denial', 'A government expels correspondents who report from its territory for news organisations based in other countries, refuses them visas or accreditation, or declines to renew their permission to stay. The effect is less independent reporting from inside the country.', 9, '2026-09-22T00:00:00Z'),
('shutdowns_and_blocking', 'Shutdowns and blocking', 'A government cuts internet or mobile telephone service, blocks news websites or social media platforms, or jams radio and television signals, so that audiences cannot receive news and reporters cannot send it out.', 10, '2026-09-22T00:00:00Z'),
('detention_and_violence', 'Detention and violence', 'Arrest, detention, prosecution, imprisonment, physical harm or killing of journalists, where police, soldiers, officials or others acting for a government carried out, ordered or authorised the act. Harm by private people is recorded only when a government actor was involved.', 11, '2026-09-22T00:00:00Z'),
('lawsuits_against_press', 'Lawsuits against the press', 'A government, a government agency or an official sues a journalist or a news organisation, usually for defamation or breach of contract, whether the official acts in office or in a personal capacity. Lawsuits that fail can still cost the defendant years of work and large legal fees.', 12, '2026-09-22T00:00:00Z'),
('disinformation_labeling', 'Official labels', 'A government officially brands a news outlet or a journalist as a source of disinformation or "fake news", or requires it to register as an agent of another country. Such labels often carry reporting duties and restrictions, and can cost the outlet its audience and advertisers.', 13, '2026-09-22T00:00:00Z');

CREATE TABLE IF NOT EXISTS countries (
  iso2 TEXT PRIMARY KEY CHECK (length(iso2) = 2),
  name TEXT NOT NULL,
  continent TEXT NOT NULL CHECK (continent IN ('africa','antarctica','asia','europe','north-america','oceania','south-america')),
  region TEXT NOT NULL,
  press_freedom_rank_latest INTEGER,
  press_freedom_rank_year INTEGER,
  press_freedom_source_url TEXT,
  press_freedom_source_id INTEGER REFERENCES sources(id),
  notes TEXT,
  updated_at TEXT
);

INSERT OR IGNORE INTO countries (iso2, name, continent, region) VALUES
('AD','Andorra','europe','Southern Europe'),
('AE','United Arab Emirates','asia','Western Asia'),
('AF','Afghanistan','asia','Southern Asia'),
('AG','Antigua and Barbuda','north-america','Caribbean'),
('AI','Anguilla','north-america','Caribbean'),
('AL','Albania','europe','Southern Europe'),
('AM','Armenia','asia','Western Asia'),
('AO','Angola','africa','Middle Africa'),
('AQ','Antarctica','antarctica','Antarctica'),
('AR','Argentina','south-america','South America'),
('AS','American Samoa','oceania','Polynesia'),
('AT','Austria','europe','Western Europe'),
('AU','Australia','oceania','Australia and New Zealand'),
('AW','Aruba','north-america','Caribbean'),
('AX','Åland Islands','europe','Northern Europe'),
('AZ','Azerbaijan','asia','Western Asia'),
('BA','Bosnia and Herzegovina','europe','Southern Europe'),
('BB','Barbados','north-america','Caribbean'),
('BD','Bangladesh','asia','Southern Asia'),
('BE','Belgium','europe','Western Europe'),
('BF','Burkina Faso','africa','Western Africa'),
('BG','Bulgaria','europe','Eastern Europe'),
('BH','Bahrain','asia','Western Asia'),
('BI','Burundi','africa','Eastern Africa'),
('BJ','Benin','africa','Western Africa'),
('BL','Saint Barthélemy','north-america','Caribbean'),
('BM','Bermuda','north-america','Northern America'),
('BN','Brunei','asia','South-eastern Asia'),
('BO','Bolivia','south-america','South America'),
('BQ','Caribbean Netherlands','north-america','Caribbean'),
('BR','Brazil','south-america','South America'),
('BS','Bahamas','north-america','Caribbean'),
('BT','Bhutan','asia','Southern Asia'),
('BV','Bouvet Island','antarctica','South America'),
('BW','Botswana','africa','Southern Africa'),
('BY','Belarus','europe','Eastern Europe'),
('BZ','Belize','north-america','Central America'),
('CA','Canada','north-america','Northern America'),
('CC','Cocos (Keeling) Islands','oceania','Australia and New Zealand'),
('CD','Democratic Republic of the Congo','africa','Middle Africa'),
('CF','Central African Republic','africa','Middle Africa'),
('CG','Republic of the Congo','africa','Middle Africa'),
('CH','Switzerland','europe','Western Europe'),
('CI','Côte d''Ivoire','africa','Western Africa'),
('CK','Cook Islands','oceania','Polynesia'),
('CL','Chile','south-america','South America'),
('CM','Cameroon','africa','Middle Africa'),
('CN','China','asia','Eastern Asia'),
('CO','Colombia','south-america','South America'),
('CR','Costa Rica','north-america','Central America'),
('CU','Cuba','north-america','Caribbean'),
('CV','Cabo Verde','africa','Western Africa'),
('CW','Curaçao','north-america','Caribbean'),
('CX','Christmas Island','oceania','Australia and New Zealand'),
('CY','Cyprus','asia','Western Asia'),
('CZ','Czechia','europe','Eastern Europe'),
('DE','Germany','europe','Western Europe'),
('DJ','Djibouti','africa','Eastern Africa'),
('DK','Denmark','europe','Northern Europe'),
('DM','Dominica','north-america','Caribbean'),
('DO','Dominican Republic','north-america','Caribbean'),
('DZ','Algeria','africa','Northern Africa'),
('EC','Ecuador','south-america','South America'),
('EE','Estonia','europe','Northern Europe'),
('EG','Egypt','africa','Northern Africa'),
('EH','Western Sahara','africa','Northern Africa'),
('ER','Eritrea','africa','Eastern Africa'),
('ES','Spain','europe','Southern Europe'),
('ET','Ethiopia','africa','Eastern Africa'),
('FI','Finland','europe','Northern Europe'),
('FJ','Fiji','oceania','Melanesia'),
('FK','Falkland Islands','south-america','South America'),
('FM','Micronesia','oceania','Micronesia'),
('FO','Faroe Islands','europe','Northern Europe'),
('FR','France','europe','Western Europe'),
('GA','Gabon','africa','Middle Africa'),
('GB','United Kingdom','europe','Northern Europe'),
('GD','Grenada','north-america','Caribbean'),
('GE','Georgia','asia','Western Asia'),
('GF','French Guiana','south-america','South America'),
('GG','Guernsey','europe','Northern Europe'),
('GH','Ghana','africa','Western Africa'),
('GI','Gibraltar','europe','Southern Europe'),
('GL','Greenland','north-america','Northern America'),
('GM','Gambia','africa','Western Africa'),
('GN','Guinea','africa','Western Africa'),
('GP','Guadeloupe','north-america','Caribbean'),
('GQ','Equatorial Guinea','africa','Middle Africa'),
('GR','Greece','europe','Southern Europe'),
('GS','South Georgia and the South Sandwich Islands','antarctica','South America'),
('GT','Guatemala','north-america','Central America'),
('GU','Guam','oceania','Micronesia'),
('GW','Guinea-Bissau','africa','Western Africa'),
('GY','Guyana','south-america','South America'),
('HK','Hong Kong','asia','Eastern Asia'),
('HM','Heard Island and McDonald Islands','antarctica','Australia and New Zealand'),
('HN','Honduras','north-america','Central America'),
('HR','Croatia','europe','Southern Europe'),
('HT','Haiti','north-america','Caribbean'),
('HU','Hungary','europe','Eastern Europe'),
('ID','Indonesia','asia','South-eastern Asia'),
('IE','Ireland','europe','Northern Europe'),
('IL','Israel','asia','Western Asia'),
('IM','Isle of Man','europe','Northern Europe'),
('IN','India','asia','Southern Asia'),
('IO','British Indian Ocean Territory','africa','Eastern Africa'),
('IQ','Iraq','asia','Western Asia'),
('IR','Iran','asia','Southern Asia'),
('IS','Iceland','europe','Northern Europe'),
('IT','Italy','europe','Southern Europe'),
('JE','Jersey','europe','Northern Europe'),
('JM','Jamaica','north-america','Caribbean'),
('JO','Jordan','asia','Western Asia'),
('JP','Japan','asia','Eastern Asia'),
('KE','Kenya','africa','Eastern Africa'),
('KG','Kyrgyzstan','asia','Central Asia'),
('KH','Cambodia','asia','South-eastern Asia'),
('KI','Kiribati','oceania','Micronesia'),
('KM','Comoros','africa','Eastern Africa'),
('KN','Saint Kitts and Nevis','north-america','Caribbean'),
('KP','North Korea','asia','Eastern Asia'),
('KR','South Korea','asia','Eastern Asia'),
('KW','Kuwait','asia','Western Asia'),
('KY','Cayman Islands','north-america','Caribbean'),
('KZ','Kazakhstan','asia','Central Asia'),
('LA','Laos','asia','South-eastern Asia'),
('LB','Lebanon','asia','Western Asia'),
('LC','Saint Lucia','north-america','Caribbean'),
('LI','Liechtenstein','europe','Western Europe'),
('LK','Sri Lanka','asia','Southern Asia'),
('LR','Liberia','africa','Western Africa'),
('LS','Lesotho','africa','Southern Africa'),
('LT','Lithuania','europe','Northern Europe'),
('LU','Luxembourg','europe','Western Europe'),
('LV','Latvia','europe','Northern Europe'),
('LY','Libya','africa','Northern Africa'),
('MA','Morocco','africa','Northern Africa'),
('MC','Monaco','europe','Western Europe'),
('MD','Moldova','europe','Eastern Europe'),
('ME','Montenegro','europe','Southern Europe'),
('MF','Saint Martin','north-america','Caribbean'),
('MG','Madagascar','africa','Eastern Africa'),
('MH','Marshall Islands','oceania','Micronesia'),
('MK','North Macedonia','europe','Southern Europe'),
('ML','Mali','africa','Western Africa'),
('MM','Myanmar','asia','South-eastern Asia'),
('MN','Mongolia','asia','Eastern Asia'),
('MO','Macao','asia','Eastern Asia'),
('MP','Northern Mariana Islands','oceania','Micronesia'),
('MQ','Martinique','north-america','Caribbean'),
('MR','Mauritania','africa','Western Africa'),
('MS','Montserrat','north-america','Caribbean'),
('MT','Malta','europe','Southern Europe'),
('MU','Mauritius','africa','Eastern Africa'),
('MV','Maldives','asia','Southern Asia'),
('MW','Malawi','africa','Eastern Africa'),
('MX','Mexico','north-america','Central America'),
('MY','Malaysia','asia','South-eastern Asia'),
('MZ','Mozambique','africa','Eastern Africa'),
('NA','Namibia','africa','Southern Africa'),
('NC','New Caledonia','oceania','Melanesia'),
('NE','Niger','africa','Western Africa'),
('NF','Norfolk Island','oceania','Australia and New Zealand'),
('NG','Nigeria','africa','Western Africa'),
('NI','Nicaragua','north-america','Central America'),
('NL','Netherlands','europe','Western Europe'),
('NO','Norway','europe','Northern Europe'),
('NP','Nepal','asia','Southern Asia'),
('NR','Nauru','oceania','Micronesia'),
('NU','Niue','oceania','Polynesia'),
('NZ','New Zealand','oceania','Australia and New Zealand'),
('OM','Oman','asia','Western Asia'),
('PA','Panama','north-america','Central America'),
('PE','Peru','south-america','South America'),
('PF','French Polynesia','oceania','Polynesia'),
('PG','Papua New Guinea','oceania','Melanesia'),
('PH','Philippines','asia','South-eastern Asia'),
('PK','Pakistan','asia','Southern Asia'),
('PL','Poland','europe','Eastern Europe'),
('PM','Saint Pierre and Miquelon','north-america','Northern America'),
('PN','Pitcairn Islands','oceania','Polynesia'),
('PR','Puerto Rico','north-america','Caribbean'),
('PS','Palestine','asia','Western Asia'),
('PT','Portugal','europe','Southern Europe'),
('PW','Palau','oceania','Micronesia'),
('PY','Paraguay','south-america','South America'),
('QA','Qatar','asia','Western Asia'),
('RE','Réunion','africa','Eastern Africa'),
('RO','Romania','europe','Eastern Europe'),
('RS','Serbia','europe','Southern Europe'),
('RU','Russia','europe','Eastern Europe'),
('RW','Rwanda','africa','Eastern Africa'),
('SA','Saudi Arabia','asia','Western Asia'),
('SB','Solomon Islands','oceania','Melanesia'),
('SC','Seychelles','africa','Eastern Africa'),
('SD','Sudan','africa','Northern Africa'),
('SE','Sweden','europe','Northern Europe'),
('SG','Singapore','asia','South-eastern Asia'),
('SH','Saint Helena, Ascension and Tristan da Cunha','africa','Western Africa'),
('SI','Slovenia','europe','Southern Europe'),
('SJ','Svalbard and Jan Mayen','europe','Northern Europe'),
('SK','Slovakia','europe','Eastern Europe'),
('SL','Sierra Leone','africa','Western Africa'),
('SM','San Marino','europe','Southern Europe'),
('SN','Senegal','africa','Western Africa'),
('SO','Somalia','africa','Eastern Africa'),
('SR','Suriname','south-america','South America'),
('SS','South Sudan','africa','Eastern Africa'),
('ST','São Tomé and Príncipe','africa','Middle Africa'),
('SV','El Salvador','north-america','Central America'),
('SX','Sint Maarten','north-america','Caribbean'),
('SY','Syria','asia','Western Asia'),
('SZ','Eswatini','africa','Southern Africa'),
('TC','Turks and Caicos Islands','north-america','Caribbean'),
('TD','Chad','africa','Middle Africa'),
('TF','French Southern Territories','antarctica','Eastern Africa'),
('TG','Togo','africa','Western Africa'),
('TH','Thailand','asia','South-eastern Asia'),
('TJ','Tajikistan','asia','Central Asia'),
('TK','Tokelau','oceania','Polynesia'),
('TL','Timor-Leste','asia','South-eastern Asia'),
('TM','Turkmenistan','asia','Central Asia'),
('TN','Tunisia','africa','Northern Africa'),
('TO','Tonga','oceania','Polynesia'),
('TR','Türkiye','asia','Western Asia'),
('TT','Trinidad and Tobago','north-america','Caribbean'),
('TV','Tuvalu','oceania','Polynesia'),
('TW','Taiwan','asia','Eastern Asia'),
('TZ','Tanzania','africa','Eastern Africa'),
('UA','Ukraine','europe','Eastern Europe'),
('UG','Uganda','africa','Eastern Africa'),
('UM','United States Minor Outlying Islands','oceania','Micronesia'),
('US','United States','north-america','Northern America'),
('UY','Uruguay','south-america','South America'),
('UZ','Uzbekistan','asia','Central Asia'),
('VA','Holy See','europe','Southern Europe'),
('VC','Saint Vincent and the Grenadines','north-america','Caribbean'),
('VE','Venezuela','south-america','South America'),
('VG','British Virgin Islands','north-america','Caribbean'),
('VI','United States Virgin Islands','north-america','Caribbean'),
('VN','Viet Nam','asia','South-eastern Asia'),
('VU','Vanuatu','oceania','Melanesia'),
('WF','Wallis and Futuna','oceania','Polynesia'),
('WS','Samoa','oceania','Polynesia'),
('XK','Kosovo','europe','Southern Europe'),
('YE','Yemen','asia','Western Asia'),
('YT','Mayotte','africa','Eastern Africa'),
('ZA','South Africa','africa','Southern Africa'),
('ZM','Zambia','africa','Eastern Africa'),
('ZW','Zimbabwe','africa','Eastern Africa');

CREATE TABLE _v2bak_events AS SELECT * FROM events;
CREATE TABLE _v2bak_incident_actors AS SELECT * FROM incident_actors;
CREATE TABLE _v2bak_incident_outlets AS SELECT * FROM incident_outlets;
CREATE TABLE _v2bak_incident_journalists AS SELECT * FROM incident_journalists;
CREATE TABLE _v2bak_incident_cases AS SELECT * FROM incident_cases;
CREATE TABLE _v2bak_incident_sources AS SELECT * FROM incident_sources;
CREATE TABLE _v2bak_incident_related AS SELECT * FROM incident_related;
CREATE TABLE _v2bak_news_desk_notes AS SELECT * FROM news_desk_notes;

CREATE TABLE incidents_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  occurred_on_precision TEXT NOT NULL DEFAULT 'day' CHECK (occurred_on_precision IN ('day','month','year','approximate')),
  ended_on TEXT, jurisdiction TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'US',
  continent TEXT CHECK (continent IS NULL OR continent IN ('africa','antarctica','asia','europe','north-america','oceania','south-america')),
  level TEXT NOT NULL CHECK (level IN ('national','state_or_province','municipal','supranational')),
  type TEXT CHECK (type IS NULL OR type IN ('access_ban','credential_revocation','lawsuit_against_press','regulatory_pressure','funding_cut','arrest_or_detention','subpoena_or_seizure','legislation','physical_obstruction','other')),
  tactic_primary TEXT REFERENCES tactics(slug),
  leader_slug TEXT,
  issue_of_the_day TEXT,
  outcome TEXT NOT NULL DEFAULT 'unknown' CHECK (outcome IN ('reversed','upheld','sustained','ongoing','unknown')),
  outcome_on TEXT, outcome_note TEXT,
  granularity TEXT NOT NULL DEFAULT 'granular' CHECK (granularity IN ('anchor','granular')),
  era TEXT GENERATED ALWAYS AS (substr(occurred_on, 1, 3) || '0s') VIRTUAL,
  summary TEXT NOT NULL, what_happened TEXT NOT NULL, stated_justification TEXT, effect_on_reporting TEXT, unknowns TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_effect','in_litigation','enjoined','reversed','expired','resolved','historical')),
  status_updated_on TEXT NOT NULL,
  external_ids TEXT NOT NULL DEFAULT '{}', illustration_key TEXT,
  pub_state TEXT NOT NULL DEFAULT 'draft' CHECK (pub_state IN ('draft','published','withdrawn')),
  published_at TEXT, reviewed_on TEXT, next_review_on TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

INSERT INTO incidents_v2 (id, slug, title, occurred_on, occurred_on_precision, ended_on, jurisdiction, country, continent, level, type,
  tactic_primary, outcome, granularity, summary, what_happened, stated_justification, effect_on_reporting, unknowns, status, status_updated_on,
  external_ids, illustration_key, pub_state, published_at, reviewed_on, next_review_on, revision, created_at, updated_at)
SELECT i.id, i.slug, i.title, i.occurred_on, i.occurred_on_precision, i.ended_on, i.jurisdiction, i.country,
  (SELECT c.continent FROM countries c WHERE c.iso2 = i.country),
  CASE i.level WHEN 'state' THEN 'state_or_province' WHEN 'local' THEN 'municipal' ELSE 'national' END,
  i.type,
  CASE i.type WHEN 'access_ban' THEN 'access_ban' WHEN 'credential_revocation' THEN 'credential_control'
    WHEN 'lawsuit_against_press' THEN 'lawsuits_against_press' WHEN 'regulatory_pressure' THEN 'funding_and_ownership_pressure'
    WHEN 'funding_cut' THEN 'funding_and_ownership_pressure' WHEN 'arrest_or_detention' THEN 'detention_and_violence'
    WHEN 'subpoena_or_seizure' THEN 'surveillance_and_subpoenas' WHEN 'physical_obstruction' THEN 'access_ban' ELSE NULL END,
  'unknown',
  CASE WHEN i.occurred_on < '2020' THEN 'anchor' ELSE 'granular' END,
  i.summary, i.what_happened, i.stated_justification, i.effect_on_reporting, i.unknowns, i.status, i.status_updated_on,
  i.external_ids, i.illustration_key, i.pub_state, i.published_at, i.reviewed_on, i.next_review_on, i.revision, i.created_at, i.updated_at
FROM incidents i;

DELETE FROM events;
DELETE FROM incident_actors;
DELETE FROM incident_outlets;
DELETE FROM incident_journalists;
DELETE FROM incident_cases;
DELETE FROM incident_sources;
DELETE FROM incident_related;
DELETE FROM news_desk_notes;

DROP TABLE incidents;
ALTER TABLE incidents_v2 RENAME TO incidents;
CREATE INDEX IF NOT EXISTS idx_incidents_date ON incidents(occurred_on);
CREATE INDEX IF NOT EXISTS idx_incidents_country ON incidents(country, occurred_on);
CREATE INDEX IF NOT EXISTS idx_incidents_tactic ON incidents(tactic_primary);
CREATE INDEX IF NOT EXISTS idx_incidents_leader ON incidents(leader_slug);

INSERT INTO news_desk_notes SELECT * FROM _v2bak_news_desk_notes;
INSERT INTO incident_actors SELECT * FROM _v2bak_incident_actors;
INSERT INTO incident_outlets SELECT * FROM _v2bak_incident_outlets;
INSERT INTO incident_journalists SELECT * FROM _v2bak_incident_journalists;
INSERT INTO incident_cases SELECT * FROM _v2bak_incident_cases;
INSERT INTO incident_sources SELECT * FROM _v2bak_incident_sources;
INSERT INTO incident_related SELECT * FROM _v2bak_incident_related;
-- The events table is restored without the six duplicate CNN rows left by
-- a killed seed-loader run (WORKLOG 2026-09-22 item 4): the lowest id of
-- each (incident_id, occurred_on, kind, label) is kept.
INSERT INTO events SELECT * FROM _v2bak_events WHERE incident_id IS NULL
  OR id IN (SELECT MIN(id) FROM _v2bak_events WHERE incident_id IS NOT NULL GROUP BY incident_id, occurred_on, kind, label);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique ON events(incident_id, occurred_on, kind, label);

DROP TABLE _v2bak_events;
DROP TABLE _v2bak_incident_actors;
DROP TABLE _v2bak_incident_outlets;
DROP TABLE _v2bak_incident_journalists;
DROP TABLE _v2bak_incident_cases;
DROP TABLE _v2bak_incident_sources;
DROP TABLE _v2bak_incident_related;
DROP TABLE _v2bak_news_desk_notes;

CREATE TABLE IF NOT EXISTS incident_tactics (
  incident_id INTEGER NOT NULL REFERENCES incidents(id),
  tactic_slug TEXT NOT NULL REFERENCES tactics(slug),
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (incident_id, tactic_slug)
);
CREATE INDEX IF NOT EXISTS idx_incident_tactics_tactic ON incident_tactics(tactic_slug);
INSERT OR IGNORE INTO incident_tactics (incident_id, tactic_slug, is_primary)
  SELECT id, tactic_primary, 1 FROM incidents WHERE tactic_primary IS NOT NULL;

CREATE TABLE IF NOT EXISTS coverage_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  publisher TEXT,
  published_at TEXT,
  summary TEXT,
  feed_url TEXT,
  jev_in_scope REAL,
  jev_model TEXT,
  tactic_guess TEXT,
  tactic_confidence REAL,
  country_guess TEXT,
  incident_id INTEGER REFERENCES incidents(id),
  state TEXT NOT NULL DEFAULT 'hidden' CHECK (state IN ('shown','hidden')),
  state_reason TEXT,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coverage_state_date ON coverage_items(state, published_at);
CREATE INDEX IF NOT EXISTS idx_coverage_title_key ON coverage_items(title_key);
