-- Emissoras de cartões de benefício (VR, VA, VT, combustível). Aditiva.
INSERT INTO "Bank" ("id", "name") VALUES
  ('alelo', 'Alelo'),
  ('pluxee', 'Pluxee (Sodexo)'),
  ('ticket', 'Ticket'),
  ('vr', 'VR Benefícios'),
  ('flash', 'Flash'),
  ('caju', 'Caju'),
  ('swile', 'Swile'),
  ('ifood-beneficios', 'iFood Benefícios'),
  ('ben', 'Ben Visa Vale')
ON CONFLICT ("id") DO NOTHING;
