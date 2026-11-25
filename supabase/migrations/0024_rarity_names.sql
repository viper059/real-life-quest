-- Fix Thai rarity names: "รีเจน" -> "เลเจนด์" (Legend), "ดีวาย" -> "ดิไวน์" (Divine)
update public.rarity_tiers set label = 'เลเจนด์' where id = 'legend';
update public.rarity_tiers set label = 'ดิไวน์' where id = 'divine';
