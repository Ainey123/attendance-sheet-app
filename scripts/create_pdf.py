import os
import json
import shutil
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(36, 11 * inch - 28, "FAST ENGINEERING SOLUTIONS | October 2026 Employee Credits Statement")
            self.drawRightString(8.5 * inch - 36, 11 * inch - 28, "Source: Bank Alfalah & UBL")
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(36, 11 * inch - 32, 8.5 * inch - 36, 11 * inch - 32)
            
        # Footer
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(8.5 * inch - 36, 25, page_text)
        self.drawString(36, 25, "Confidential - Management Payout Summary | October 1 to October 31, 2026")
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(36, 35, 8.5 * inch - 36, 35)
        self.restoreState()

def generate_pdf(output_filename):
    doc = SimpleDocTemplate(
        output_filename,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=40,
        bottomMargin=42
    )
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0F172A")
    )
    
    sec_header_style = ParagraphStyle(
        'SecHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=colors.HexColor("#1E3A8A"),
        spaceBefore=10,
        spaceAfter=5
    )
    
    emp_heading_style = ParagraphStyle(
        'EmpHeading',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#0F172A")
    )
    
    cell_style = ParagraphStyle(
        'GridCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#1E293B")
    )

    cell_bold = ParagraphStyle(
        'GridCellBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#0F172A")
    )
    
    cell_right = ParagraphStyle(
        'GridCellRight',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        alignment=2,
        textColor=colors.HexColor("#0F172A")
    )
    
    cell_right_bold = ParagraphStyle(
        'GridCellRightBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        alignment=2,
        textColor=colors.HexColor("#0F172A")
    )
    
    tbl_hdr_style = ParagraphStyle(
        'TblHdr',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white
    )

    tbl_hdr_right = ParagraphStyle(
        'TblHdrRight',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        alignment=2,
        textColor=colors.white
    )
    
    elements = []
    
    # Header Banner
    header_data = [
        [
            Paragraph("<b>FAST ENGINEERING SOLUTIONS</b><br/><font size=8.5 color='#475569'>House No. 52, Al-Jannat Housing Society, Raiwind Road, Lahore</font>", styles['Normal']),
            Paragraph("<b>OCTOBER 2026 EMPLOYEE CREDITS</b><br/><font size=8 color='#475569'><b>Statement Period:</b> 01-Oct-2026 to 31-Oct-2026<br/><b>Sources:</b> Bank Alfalah (00761007345220) & UBL (2121-317846744)</font>", ParagraphStyle('HdrR', parent=styles['Normal'], alignment=2))
        ]
    ]
    t_header = Table(header_data, colWidths=[280, 260])
    t_header.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))
    elements.append(t_header)
    elements.append(Spacer(1, 6))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#1E3A8A"), spaceBefore=0, spaceAfter=8))
    
    # Executive Summary Cards
    summary_cards_data = [
        [
            Paragraph("<b>Requested Staff</b><br/><font size=12 color='#1E3A8A'><b>11 Employees</b></font><br/><font size=7 color='#64748B'>10 Active / 1 Nil</font>", cell_style),
            Paragraph("<b>Total Transactions</b><br/><font size=12 color='#0D9488'><b>54 Payments</b></font><br/><font size=7 color='#64748B'>Debited to Staff</font>", cell_style),
            Paragraph("<b>Bank Alfalah</b><br/><font size=12 color='#B45309'><b>PKR 31,333.00</b></font><br/><font size=7 color='#64748B'>2 Transfers</font>", cell_style),
            Paragraph("<b>UBL Transfers</b><br/><font size=12 color='#2563EB'><b>PKR 662,221.00</b></font><br/><font size=7 color='#64748B'>52 Transfers</font>", cell_style),
            Paragraph("<b>Grand Total Payout</b><br/><font size=12 color='#0F172A'><b>PKR 693,554.00</b></font><br/><font size=7 color='#64748B'>October Disbursed</font>", cell_style),
        ]
    ]
    t_cards = Table(summary_cards_data, colWidths=[108, 108, 108, 108, 108])
    t_cards.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F8FAFC")),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#E2E8F0")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#CBD5E1")),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
    ]))
    elements.append(t_cards)
    elements.append(Spacer(1, 10))
    
    # Summary Table Section
    elements.append(Paragraph("<b>1. Summary Payout by Employee (October 2026)</b>", sec_header_style))
    
    sum_headers = [
        Paragraph("<b>#</b>", tbl_hdr_style),
        Paragraph("<b>Employee Name</b>", tbl_hdr_style),
        Paragraph("<b>Primary Receiving Channel / Account</b>", tbl_hdr_style),
        Paragraph("<b>Bank</b>", tbl_hdr_style),
        Paragraph("<b>Txns</b>", tbl_hdr_right),
        Paragraph("<b>Total Credited (PKR)</b>", tbl_hdr_right)
    ]
    
    sum_rows = [
        [
            Paragraph("1", cell_style),
            Paragraph("<b>Ali Shehzad</b> (Ali Shahzad)", cell_style),
            Paragraph("JazzCash PK48JCMA*********250", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("2", cell_right),
            Paragraph("45,000.00", cell_right_bold)
        ],
        [
            Paragraph("2", cell_style),
            Paragraph("<b>Muhammad Ibrahim</b>", cell_style),
            Paragraph("Meezan Bank 11640113815198 (Asaan A/C)", cell_style),
            Paragraph("Alfalah", cell_style),
            Paragraph("1", cell_right),
            Paragraph("29,333.00", cell_right_bold)
        ],
        [
            Paragraph("3", cell_style),
            Paragraph("<b>Muhammad Danish Ali</b> (req: Muhammad Daish)", cell_style),
            Paragraph("Easypaisa PK33TMFB*********452", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("8", cell_right),
            Paragraph("94,372.00", cell_right_bold)
        ],
        [
            Paragraph("4", cell_style),
            Paragraph("<b>Muhammad Ali</b>", cell_style),
            Paragraph("JazzCash PK62JCMA*********807 & Mobilink Bank", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("12", cell_right),
            Paragraph("89,002.00", cell_right_bold)
        ],
        [
            Paragraph("5", cell_style),
            Paragraph("<b>FES Faisal Elec Vehari</b> (req: FES Ali Vehari / M. Faisal)", cell_style),
            Paragraph("JazzCash PK19JCMA*********145", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("3", cell_right),
            Paragraph("27,731.00", cell_right_bold)
        ],
        [
            Paragraph("6", cell_style),
            Paragraph("<b>Rehman Ali</b>", cell_style),
            Paragraph("UBL Internal Transfer (A/C 0003****9374)", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("6", cell_right),
            Paragraph("217,202.00", cell_right_bold)
        ],
        [
            Paragraph("7", cell_style),
            Paragraph("<b>Abaid Ullah</b> (Ubaid Ullah)", cell_style),
            Paragraph("Easypaisa PK22TMFB*********337", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("2", cell_right),
            Paragraph("35,000.00", cell_right_bold)
        ],
        [
            Paragraph("8", cell_style),
            Paragraph("<b>Muhammad Asif</b>", cell_style),
            Paragraph("Easypaisa PK80TMFB...494 & 03104626317", cell_style),
            Paragraph("Alfalah + UBL", cell_style),
            Paragraph("16", cell_right),
            Paragraph("80,544.00", cell_right_bold)
        ],
        [
            Paragraph("9", cell_style),
            Paragraph("<b>Asif Rasheed</b>", cell_style),
            Paragraph("JazzCash PK43JCMA*********935", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("8", cell_right),
            Paragraph("75,350.00", cell_right_bold)
        ],
        [
            Paragraph("10", cell_style),
            Paragraph("<b>Wajahat Afzal</b> (Muhammad Wajahat Afz)", cell_style),
            Paragraph("JazzCash PK15...531 & Easypaisa PK29...710", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("3", cell_right),
            Paragraph("8,770.00", cell_right_bold)
        ],
        [
            Paragraph("11", cell_style),
            Paragraph("<b>Muhammad Faisal</b> (Additional: Faisal Shehzad)", cell_style),
            Paragraph("JazzCash PK82JCMA*********137", cell_style),
            Paragraph("UBL", cell_style),
            Paragraph("1", cell_right),
            Paragraph("4,150.00", cell_right_bold)
        ],
        [
            Paragraph("12", cell_style),
            Paragraph("<b>Asjad</b>", cell_style),
            Paragraph("No transactions found in October statements (NIL)", cell_style),
            Paragraph("Both", cell_style),
            Paragraph("0", cell_right),
            Paragraph("0.00", cell_right_bold)
        ],
    ]
    
    total_row = [
        Paragraph("", cell_style),
        Paragraph("<b>GRAND TOTAL (Requested Employees)</b>", cell_bold),
        Paragraph("<b>All Listed Payout Accounts</b>", cell_bold),
        Paragraph("<b>Both Banks</b>", cell_bold),
        Paragraph("<b>54</b>", cell_right_bold),
        Paragraph("<b>693,554.00</b>", cell_right_bold)
    ]
    
    t_summary = Table([sum_headers] + sum_rows + [total_row], colWidths=[18, 162, 160, 60, 45, 95])
    t_summary.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#1E3A8A")),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('ROWBACKGROUNDS', (0,1), (-1,-2), [colors.white, colors.HexColor("#F8FAFC")]),
        ('GRID', (0,0), (-1,-2), 0.5, colors.HexColor("#E2E8F0")),
        ('BACKGROUND', (0,-1), (-1,-1), colors.HexColor("#E2E8F0")),
        ('LINEABOVE', (0,-1), (-1,-1), 1.5, colors.HexColor("#0F172A")),
    ]))
    elements.append(t_summary)
    elements.append(Spacer(1, 12))
    
    # Detailed Itemized Transactions Section
    elements.append(Paragraph("<b>2. Itemized Transaction Logs by Employee</b>", sec_header_style))
    elements.append(Paragraph("<font size=7.5 color='#64748B'>Chronological breakdown of each transaction credited to the employee from Bank Alfalah and UBL accounts during October 2026.</font>", styles['Normal']))
    elements.append(Spacer(1, 6))
    
    with open('employee_october_data.json', 'r', encoding='utf-8') as f:
        emp_data = json.load(f)
        
    det_headers = [
        Paragraph("<b>Date</b>", tbl_hdr_style),
        Paragraph("<b>Bank</b>", tbl_hdr_style),
        Paragraph("<b>Channel</b>", tbl_hdr_style),
        Paragraph("<b>Recipient Account / Method</b>", tbl_hdr_style),
        Paragraph("<b>Transaction Ref / MSGID</b>", tbl_hdr_style),
        Paragraph("<b>Amount (PKR)</b>", tbl_hdr_right)
    ]
    
    display_order = [
        ("1. Ali Shehzad (Ali Shahzad)", "Ali Shehzad"),
        ("2. Muhammad Ibrahim", "Muhammad Ibrahim"),
        ("3. Muhammad Danish Ali (Danish Ali / req: Muhammad Daish)", "Muhammad Danish Ali (Danish Ali)"),
        ("4. Muhammad Ali", "Muhammad Ali"),
        ("5. FES Faisal Elec Vehari (associated with: FES Ali Vehari / Muhammad Faisal)", "FES Faisal Elec Vehari (FES Ali Vehari / Muhammad Faisal)"),
        ("6. Rehman Ali", "Rehman Ali"),
        ("7. Abaid Ullah (Ubaid Ullah)", "Abaid Ullah (Ubaid Ullah)"),
        ("8. Muhammad Asif", "Muhammad Asif"),
        ("9. Asif Rasheed", "Asif Rasheed"),
        ("10. Wajahat Afzal (Muhammad Wajahat Afz)", "Wajahat Afzal (Muhammad Wajahat Afz)"),
        ("11. Faisal Shehzad (Additional Reference for Muhammad Faisal)", "Faisal Shehzad"),
    ]
    
    for section_title, key in display_order:
        tx_list = emp_data.get(key, [])
        if not tx_list:
            continue
            
        subtotal = sum(item['amount'] for item in tx_list)
        
        emp_flowables = []
        emp_flowables.append(Spacer(1, 6))
        
        hdr_bar = Table([
            [
                Paragraph(f"<b>{section_title}</b>", emp_heading_style),
                Paragraph(f"<b>Subtotal: PKR {subtotal:,.2f}</b> ({len(tx_list)} Tx)", ParagraphStyle('Subtot', parent=styles['Normal'], alignment=2, fontName='Helvetica-Bold', fontSize=8.5, textColor=colors.HexColor("#1E3A8A")))
            ]
        ], colWidths=[380, 160])
        hdr_bar.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#EFF6FF")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('LEFTPADDING', (0,0), (-1,-1), 5),
            ('RIGHTPADDING', (0,0), (-1,-1), 5),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#BFDBFE")),
        ]))
        emp_flowables.append(hdr_bar)
        emp_flowables.append(Spacer(1, 2))
        
        tx_rows = []
        for it in tx_list:
            desc = it['description']
            msg_id = ""
            if "MSGID:" in desc:
                msg_id = "MSGID: " + desc.split("MSGID:")[1].strip()
            elif "Ref:" in desc:
                msg_id = "Ref: " + desc.split("Ref:")[1].strip()
            else:
                msg_id = desc[:45] + ("..." if len(desc) > 45 else "")
                
            tx_rows.append([
                Paragraph(it['date'], cell_style),
                Paragraph(it['bank'], cell_style),
                Paragraph(it['channel'], cell_style),
                Paragraph(it['account'], cell_style),
                Paragraph(f"<font size=6.5 color='#475569'>{msg_id}</font>", cell_style),
                Paragraph(f"{it['amount']:,.2f}", cell_right)
            ])
            
        t_det = Table([det_headers] + tx_rows, colWidths=[55, 55, 80, 150, 120, 80], repeatRows=1)
        t_det.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#334155")),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
            ('LEFTPADDING', (0,0), (-1,-1), 4),
            ('RIGHTPADDING', (0,0), (-1,-1), 4),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F8FAFC")]),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
        ]))
        emp_flowables.append(t_det)
        
        if len(tx_list) <= 4:
            elements.append(KeepTogether(emp_flowables))
        else:
            elements.extend(emp_flowables)
            
    # Asjad Note & Special Mappings
    notes_flowables = []
    notes_flowables.append(Spacer(1, 12))
    notes_flowables.append(Paragraph("<b>3. Reconciliation Notes & Cross-Reference Mapping</b>", sec_header_style))
    
    notes_text = """
    • <b>Muhammad Daish:</b> Identified in the UBL statement as <b>MUHAMMAD DANISH ALI</b> (Easypaisa PK33TMFB*********452), receiving 8 payments totaling <b>PKR 94,372.00</b>.<br/>
    • <b>Muhammad Ali as FES Ali Vehari:</b> In UBL statements, two distinct matching recipient profiles exist: (1) Direct transfers to <b>MUHAMMAD ALI</b> (JazzCash PK62JCMA*********807 & Mobilink Microfinance Bank) receiving 12 payments totaling <b>PKR 89,002.00</b>; and (2) Transfers to <b>FES FAISAL ELEC VEHA</b> (JazzCash PK19JCMA*********145) receiving 3 payments totaling <b>PKR 27,731.00</b>.<br/>
    • <b>Muhammad Faisal:</b> Associated with the <b>FES FAISAL ELEC VEHA</b> payments (PKR 27,731.00) and <b>FAISAL SHEHZAD</b> (PKR 4,150.00). No plain 'Muhammad Faisal' title appears in bank records.<br/>
    • <b>Abaid Ullah:</b> Appears as <b>UBAID ULLAH</b> (Easypaisa PK22TMFB*********337) receiving 2 payments totaling <b>PKR 35,000.00</b>.<br/>
    • <b>Muhammad Asif:</b> Received funds from <b>both banks</b>: Bank Alfalah (1 payment of PKR 2,000.00) and UBL (15 payments totaling PKR 78,544.00), bringing his grand total to <b>PKR 80,544.00</b> across 16 transactions.<br/>
    • <b>Muhammad Ibrahim:</b> Received 1 payment of <b>PKR 29,333.00</b> from Bank Alfalah via Meezan Bank Asaan Account.<br/>
    • <b>Rehman Ali:</b> Received 6 internal digital transfers to UBL Account 0003****9374 totaling <b>PKR 217,202.00</b>. (Note: A separate Raast payment of PKR 70,000.00 was sent to 'ALI REHMAN' on Meezan Bank PK16MEZN*********937).<br/>
    • <b>Asjad:</b> Exhaustive search across all transactions in both Bank Alfalah and UBL statements returned <b>0 records (NIL)</b> for October 2026.
    """
    
    t_notes = Table([[Paragraph(notes_text, styles['Normal'])]], colWidths=[540])
    t_notes.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F8FAFC")),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#CBD5E1")),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    notes_flowables.append(t_notes)
    elements.append(KeepTogether(notes_flowables))
    
    doc.build(elements, canvasmaker=NumberedCanvas)
    
    # Also copy to Downloads folder for immediate user convenience
    downloads_dir = os.path.expanduser(r"~\Downloads")
    if os.path.exists(downloads_dir):
        dest = os.path.join(downloads_dir, os.path.basename(output_filename))
        shutil.copy2(output_filename, dest)
        print(f"Also copied to: {dest}")

if __name__ == '__main__':
    out_pdf = r"c:\Users\SL LAPTOP\Desktop\Attendence sheet app\October_2026_Employee_Credits_Statement.pdf"
    generate_pdf(out_pdf)
