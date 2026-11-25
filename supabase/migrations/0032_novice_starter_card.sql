-- การ์ดที่แจกทุกคนตอนสมัคร: เปลี่ยนเป็น "โนวิส" โบนัส EXP +2% (id เดิม adventurer เพื่อไม่ให้เด็คและผู้เล่นเดิมเสีย)
update public.job_cards
   set name = 'โนวิส', exp_bonus_pct = 2, description = 'การ์ดเริ่มต้นของทุกคน EXP +2% ทุกเควสต์'
 where id = 'adventurer';
