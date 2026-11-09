import pypdf, re, json

def clean_ubl_pages():
    reader = pypdf.PdfReader(r'C:\Users\SL LAPTOP\Downloads\UBL-05-Nov-2026 13_28_31.pdf')
    transactions = []
    
    # regex for transaction date at start of line
    date_regex = re.compile(r'^(\d{2}-[A-Za-z]{3}-2026)\s+(.*)')
    
    for page_idx, page in enumerate(reader.pages):
        text = page.extract_text()
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        
        # Filter out header and footer lines
        body_lines = []
        for l in lines:
            if any(l.startswith(prefix) for prefix in [
                'Account Statement', 'Printed on', 'Account Number:',
                'For latest schedule', 'UBL website', 'UBLUnitedBankLtd',
                'www.ubldigital.com', '111-825-888', 'ubldigital', 'United-Bank-Limited',
                'Fast Engineering Solutions', 'House No', 'Near Lda', 'Lahore',
                'Balance: PKR', 'As of:', 'Account type:', 'Currency:', 'Reg. Cell',
                'IBAN No:', 'CIF:', 'Branch:', 'Branch Code:', 'Activity Summary',
                'DATE PARTICULARS INST. NO. DEBIT CREDIT BALANCE',
                '01-Oct-2026 - 31-Oct-2026', 'Page '
            ]):
                continue
            body_lines.append(l)
            
        # Now chunk body_lines by date
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
            
    return transactions

txs = clean_ubl_pages()
print(f'Total parsed clean UBL transactions: {len(txs)}')

with open('ubl_clean_txs_v2.json', 'w', encoding='utf-8') as f:
    json.dump(txs, f, indent=2)
