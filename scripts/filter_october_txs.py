import json

with open('ubl_clean_txs.json', 'r', encoding='utf-8') as f:
    ubl_txs = json.load(f)

with open('alfalah_clean_txs.json', 'r', encoding='utf-8') as f:
    alf_txs = json.load(f)

print('=== ALFALAH TRANSACTIONS ===')
for idx, tx in enumerate(alf_txs):
    txt = ' '.join(tx['lines'])
    page = tx['page']
    print(f'{idx+1}. P{page}: {txt}\n')

print('\n=== CHECKING UBL FOR CANDIDATE NAMES ===')
for idx, tx in enumerate(ubl_txs):
    txt = ' '.join(tx['lines'])
    low = txt.lower()
    for kw in ['shehzad', 'shahzad', 'ibrahim', 'danish', 'fes', 'veha', 'rehman', 'abaid', 'ubaid', 'asif', 'rasheed', 'wajahat', 'afz', 'faisal', 'asjad']:
        if kw in low:
            page = tx['page']
            print(f'UBL #{idx+1} [P{page}] ({kw}): {txt}\n')
            break
