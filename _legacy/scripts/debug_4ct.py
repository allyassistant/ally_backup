import pdfplumber
import re

pdf_path = "/Users/ally/Downloads/Round Price List 01.30.2026.pdf"

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        
        # Look for 4.00-4.99 section
        if "4.00" in text and "4.99" in text:
            print(f"Page {page_num} - 4.00-4.99 section found")
            print("=" * 60)
            
            lines = text.split('\n')
            
            # Print all lines around 4.00-4.99
            in_section = False
            for i, line in enumerate(lines):
                if "4.00" in line and "4.99" in line:
                    in_section = True
                    print(f"\nHeader: {line}")
                    # Print next 20 lines
                    for j in range(i+1, min(i+25, len(lines))):
                        if "5.00" in lines[j] and "5.99" in lines[j]:
                            break
                        if lines[j].strip():
                            print(f"  {lines[j]}")
                    break
            break

print("\n" + "=" * 60)
print("Looking for all color rows in 4.00-4.99...")

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        
        if "4.00" in text and "4.99" in text:
            lines = text.split('\n')
            
            in_section = False
            for line in lines:
                if "4.00" in line and "4.99" in line:
                    in_section = True
                    continue
                if "5.00" in line and "5.99" in line:
                    break
                    
                if in_section:
                    # Look for color rows (D, E, F, etc)
                    match = re.match(r'^([D-M])\s+(\d.*)$', line.strip())
                    if match:
                        color = match.group(1)
                        nums = re.findall(r'\d+', match.group(2))
                        print(f"\n{color}: {nums}")
            break
