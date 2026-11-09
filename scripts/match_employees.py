import json

with open('ubl_structured.json', 'r', encoding='utf-8') as f:
    ubl = json.load(f)

with open('alfalah_structured.json', 'r', encoding='utf-8') as f:
    alf = json.load(f)

# Let's inspect each employee:
# 1. ali shehzad (Ali Shehzad / Ali Shahzad)
# 2. muhammad ibrahim
# 3. muhammad daish as danish ali (Muhammad Danish Ali / Danish Ali)
# 4. muhammad ali as fes ali vehari:
#    Let's check:
#    - Muhammad Ali
#    - FES Faisal Elec Vehari (PK19JCMA...145)
#    - Faisal Shehzad (PK82JCMA...137)
# 5. rehman ali
# 6. abaid ullah (Ubaid Ullah / Abaid Ullah)
# 7. muhammad asif
# 8. asif rasheed
# 9. wajahat afzal (Muhammad Wajahat Afzal / Muhammad Wajahat Afz)
# 10. muhammad faisal
# 11. asjad

print("--- 1. ALI SHEHZAD / ALI SHAHZAD ---")
for t in ubl:
    if 'ali shahzad' in t['particulars'].lower() or 'ali shehzad' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'ali shahzad' in t['particulars'].lower() or 'ali shehzad' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 2. MUHAMMAD IBRAHIM ---")
for t in ubl:
    if 'ibrahim' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'ibrahim' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 3. MUHAMMAD DAISH / DANISH ALI ---")
for t in ubl:
    if 'danish' in t['particulars'].lower() or 'daish' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'danish' in t['particulars'].lower() or 'daish' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 4. MUHAMMAD ALI ---")
for t in ubl:
    if 'to muhammad ali' in t['particulars'].lower() or 'to: muhammad ali' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'to muhammad ali' in t['particulars'].lower() or 'to: muhammad ali' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 4b. FES FAISAL ELEC VEHA (fes ali vehari / Faisal) ---")
for t in ubl:
    if 'fes' in t['particulars'].lower() or 'veha' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'fes' in t['particulars'].lower() or 'veha' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 5. REHMAN ALI ---")
for t in ubl:
    if 'rehman ali' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'rehman ali' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 6. ABAID ULLAH / UBAID ULLAH ---")
for t in ubl:
    if 'abaid' in t['particulars'].lower() or 'ubaid' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'abaid' in t['particulars'].lower() or 'ubaid' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 7. MUHAMMAD ASIF ---")
for t in ubl:
    if 'to muhammad asif' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'to muhammad asif' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 8. ASIF RASHEED ---")
for t in ubl:
    if 'asif rasheed' in t['particulars'].lower() or 'asif rashid' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'asif rasheed' in t['particulars'].lower() or 'asif rashid' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 9. WAJAHAT AFZAL ---")
for t in ubl:
    if 'wajahat' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'wajahat' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 10. MUHAMMAD FAISAL / FAISAL ---")
for t in ubl:
    if 'faisal' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'faisal' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])

print("\n--- 11. ASJAD ---")
for t in ubl:
    if 'asjad' in t['particulars'].lower():
        print("UBL:", t['date'], t['debit'], t['particulars'])
for t in alf:
    if 'asjad' in t['particulars'].lower():
        print("Alfalah:", t['date'], t['amt1'], t['particulars'])
