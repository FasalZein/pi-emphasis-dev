#!/usr/bin/env bash
# Print every terminal emphasis style in a sentence so you can see which ones your terminal draws.
E=$'\e['
R="${E}0m"
row() { printf '  %-22s The %s%s%s is ready.\n' "$1" "$2" "$3" "$R"; }

echo "Text attributes"
row "bold (1)"               "${E}1m"  "checkout deploy"
row "dim (2)"                "${E}2m"  "checkout deploy"
row "italic (3)"             "${E}3m"  "checkout deploy"
row "underline (4)"          "${E}4m"  "checkout deploy"
row "double underline"       "${E}4:2m" "checkout deploy"
row "curly underline"        "${E}4:3m" "checkout deploy"
row "dotted underline"       "${E}4:4m" "checkout deploy"
row "dashed underline"       "${E}4:5m" "checkout deploy"
row "colored curly"          "${E}4:3m${E}58:2::255:110:110m" "checkout deploy"
row "strikethrough (9)"      "${E}9m"  "checkout deploy"
row "overline (53)"          "${E}53m" "checkout deploy"
row "inverse (7)"            "${E}7m"  "checkout deploy"
row "blink (5)"              "${E}5m"  "checkout deploy"
row "framed (51)"            "${E}51m" "checkout deploy"
row "encircled (52)"         "${E}52m" "checkout deploy"

echo
echo "Built from color and glyphs"
row "background chip"        "${E}48;2;38;58;105m${E}38;2;205;222;255m" " checkout deploy "
# Nerd Font rounded caps drawn in the chip color turn the background into a pill.
printf '  %-22s The %s%s%s%s%s%s is ready.\n' "pill (Nerd Font caps)" \
  "${E}38;2;38;58;105m" $'\ue0b6' "${E}48;2;38;58;105m${E}38;2;205;222;255m" "checkout deploy" "${R}${E}38;2;38;58;105m" $'\ue0b4'"${R}"
# One-eighth blocks for the sides, overline and underline for the top and bottom.
printf '  %-22s The %s%s%s is ready.\n' "box (53 + 4 + ▕▏)" "${E}53;4m" "▕checkout deploy▏" "$R"
row "brackets"               "" "⟦checkout deploy⟧"

echo
echo "Size"
# kitty text sizing protocol: scale 2 occupies two rows and twice the width.
printf '  %-22s The \e]66;s=2;checkout deploy\a is ready.\n\n' "kitty scale (OSC 66)"
printf '\e#3  DEC double height   The checkout deploy is ready.\n'
printf '\e#4  DEC double height   The checkout deploy is ready.\n'
printf '\e#6  DEC double width    The checkout deploy\n'
printf '\e#5'
echo
