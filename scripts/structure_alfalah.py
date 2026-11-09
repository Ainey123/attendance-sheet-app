import pypdf, re, json

def clean_alfalah():
    reader = pypdf.PdfReader(r'C:\Users\SL LAPTOP\Downloads\0076100734522011052026020244.pdf')
    transactions = []
    
    date_regex = re.compile(r'^(\d{2}-\d{2}-2026)\s+(.*)')
    amount_re = re.compile(r'([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$')
    
    for page_idx, page in enumerate(reader.pages):
        text = page.extract_text()
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        
        body_lines = []
        for l in lines:
            if any(l.startswith(prefix) for prefix in [
                'Statement Of Account', 'Page ', 'Title Of Account', 'Account #',
                'Registered Address', 'IBAN', 'Nature of Account', 'Currency',
                'Date Of Account Opened', 'Registered Contact No', 'Raiwind Road Branch',
                'Date Description Cheq/Inst# Debit Credit Balance', 'Opening Balance',
                'Closing Balance'
            ]):
                continue
            body_lines.append(l)
            
        curr_tx = None
        for l in body_lines:
            m = date_regex.match(l)
            if m:
                if curr_tx:
                    transactions.append(curr_tx)
                curr_tx = {'page': page_idx + 1, 'date': m.group(1), 'lines': [m.group(2)]}
            elif curr_tx:
                curr_tx['lines'].append(l)
        if curr_tx:
            transactions.append(curr_tx)
            
    # Structure amounts
    for t in transactions:
        full_str = ' '.join(t['lines'])
        last_line = t['lines'][-1]
        m = amount_re.search(last_line)
        if m:
            # Alfalah has columns: Date Description Cheq/Inst# Debit Credit Balance
            # Sometimes single amount + balance (if debit, or if credit)
            t['amt1'] = m.group(1)
            t['balance'] = m.group(2)
            t['particulars'] = (' '.join(t['lines'][:-1]) + ' ' + last_line[:m.start()]).strip()
        else:
            t['particulars'] = full_str
            
    return transactions

txs = clean_alfalah()
print('Total Alfalah structured:', len(txs))
with open('alfalah_structured.json', 'w', encoding='utf-8') as f:
    json.dump(txs, f, indent=2)
for t in txs:
    print(t['date'], '|', t.get('amt1'), '|', t.get('balance'), '|', t['particulars'][:60])
