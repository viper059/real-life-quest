-- Rename career_ranks.label to RPG-style set (F=ผู้เริ่มต้น ... S=เลเจนด์)
-- F rank is renamed (not removed); "โนวิส" (Novice) is a separate, display-only
-- pre-career status for users with zero occupations started — not stored in
-- career_ranks, rendered client-side in js/me.js's renderCareers() empty state.

update career_ranks set label = case rank
  when 'F' then 'ผู้เริ่มต้น'
  when 'E' then 'อาเดปต์'
  when 'D' then 'เวเทอรัน'
  when 'C' then 'เอ็กซ์เพิร์ต'
  when 'B' then 'มาสเตอร์'
  when 'A' then 'แกรนด์มาสเตอร์'
  when 'S' then 'เลเจนด์'
  else label end;
